// Derives the browser engines a CI step actually launches and audits the
// workflow order: a step may only launch an engine that an earlier step
// installed at the locked Playwright version.
//
// Engine vocabulary:
//   chromium | firefox | webkit -> Playwright's own bundled builds
//   chrome                      -> a real system Chrome/Chromium, resolved by
//                                  findChromeExecutable() in
//                                  browser helper modules and
//                                  installed through Playwright's `chrome`
//                                  channel on CI.

export const PLAYWRIGHT_ENGINES = ["chromium", "firefox", "webkit"];
export const INSTALLABLE_ENGINES = [...PLAYWRIGHT_ENGINES, "chrome", "msedge"];

const STEP_INDENT = "      - ";

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// Minimal, shape-specific reader for this repository's workflow files. It is
// intentionally not a general YAML parser: it only understands the step list of
// one job, scalar keys and block scalars (`run: |`).
export function parseWorkflowSteps(text, jobName) {
  const lines = text.split(/\r?\n/u);
  const jobLine = lines.findIndex((line) => line === `  ${jobName}:`);
  if (jobLine === -1) throw new Error(`job ${jobName} is missing`);
  let index = lines.findIndex(
    (line, position) => position > jobLine && line === "    steps:",
  );
  if (index === -1) throw new Error(`job ${jobName} has no steps`);
  index += 1;
  const blocks = [];
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (line.startsWith(STEP_INDENT)) {
      blocks.push([`        ${line.slice(STEP_INDENT.length)}`]);
      continue;
    }
    if (line.startsWith("        ")) {
      if (blocks.length === 0) throw new Error("dangling step body");
      blocks[blocks.length - 1].push(line);
      continue;
    }
    break;
  }
  return blocks.map((block, position) => {
    const step = { index: position, raw: block.join("\n") };
    for (let cursor = 0; cursor < block.length; cursor += 1) {
      const line = block[cursor];
      if (!line.startsWith("        ") || line.startsWith("         "))
        continue;
      const match = /^ {8}([\w-]+):(.*)$/u.exec(line);
      if (match === null) continue;
      const [, key, rest] = match;
      const value = rest.trim();
      if (value === "|" || value === ">") {
        const body = [];
        while (
          cursor + 1 < block.length &&
          block[cursor + 1].startsWith(" ".repeat(10))
        ) {
          cursor += 1;
          body.push(block[cursor].slice(10));
        }
        step[key] = body.join(value === "|" ? "\n" : " ");
        continue;
      }
      if (value === "") {
        const body = [];
        while (
          cursor + 1 < block.length &&
          block[cursor + 1].startsWith(" ".repeat(10))
        ) {
          cursor += 1;
          body.push(block[cursor].trim());
        }
        step[key] = body.join("\n");
        continue;
      }
      step[key] = stripQuotes(value);
    }
    return step;
  });
}

export function readLockPlaywrightVersion(lock) {
  const candidates = [
    "node_modules/@playwright/test",
    "node_modules/playwright",
    "node_modules/playwright-core",
  ];
  for (const key of candidates) {
    const version = lock?.packages?.[key]?.version;
    if (typeof version === "string" && version.length > 0) return version;
  }
  throw new Error("package-lock.json does not pin a Playwright version");
}

function importedEngines(source) {
  const imported = new Set();
  for (const match of source.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*"playwright(?:\/test)?"/gu,
  )) {
    for (const part of match[1].split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/u)[0]
        .trim();
      if (PLAYWRIGHT_ENGINES.includes(name)) imported.add(name);
    }
  }
  return imported;
}

// An engine is optional when the script selects it only through an explicit
// environment switch (`process.env.X === "webkit" ? webkit : chromium`). Such an
// engine becomes required as soon as a command sets that value.
function isEnvSelected(source, engine) {
  return new RegExp(
    `process\\.env\\.\\w+\\s*(?:===|==)\\s*"${engine}"[\\s\\S]{0,160}?\\?\\s*"?${engine}\\b`,
    "u",
  ).test(source);
}

export function enginesForScriptSource(source) {
  const required = new Set();
  const optional = new Set();
  // A real system Chrome is resolved through the shared support module.
  if (/findChromeExecutable/u.test(source)) required.add("chrome");
  for (const engine of importedEngines(source)) {
    if (engine === "chromium") {
      const launches = [
        ...source.matchAll(/chromium\.launch\(([\s\S]{0,240})/gu),
      ];
      const bundled =
        launches.length === 0 ||
        launches.some((match) => !/executablePath/u.test(match[1]));
      const viaTernary = /[?:]\s*chromium\s*\)\s*\.launch\(/u.test(source);
      // Every chromium.launch() pins an executablePath: the script drives a
      // system Chrome, not Playwright's bundled Chromium.
      if (!bundled && !viaTernary) continue;
    }
    if (isEnvSelected(source, engine)) optional.add(engine);
    else required.add(engine);
  }
  return { required, optional };
}

function splitSegments(command) {
  return command
    .split(/\n|&&|\|\||;/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

// Resolves `npm run <script>` chains down to the node scripts they execute and
// unions their engine requirements.
export function resolveCommandEngines(
  command,
  scripts,
  loadSource,
  seen = new Set(),
) {
  const required = new Set();
  const optional = new Set();
  const envValues = new Set();
  for (const segment of splitSegments(command)) {
    let rest = segment;
    while (true) {
      const match = /^([A-Z][A-Z0-9_]*)=(\S*)\s+/u.exec(rest);
      if (match === null) break;
      envValues.add(match[2]);
      rest = rest.slice(match[0].length);
    }
    const runScript = /^npm\s+run\s+([\w:.-]+)/u.exec(rest);
    if (runScript !== null) {
      const name = runScript[1];
      if (seen.has(name)) continue;
      seen.add(name);
      const definition = scripts[name];
      if (definition === undefined) continue;
      for (const pre of [`pre${name}`, name, `post${name}`]) {
        const body = scripts[pre];
        if (body === undefined || (pre !== name && seen.has(pre))) continue;
        if (pre !== name) seen.add(pre);
        const nested = resolveCommandEngines(body, scripts, loadSource, seen);
        for (const engine of nested.required) required.add(engine);
        for (const engine of nested.optional) optional.add(engine);
        for (const value of nested.envValues) envValues.add(value);
      }
      continue;
    }
    const nodeScript = /^node\s+(?:--\S+\s+)*(scripts\/[\w./-]+\.mjs)/u.exec(
      rest,
    );
    if (nodeScript !== null) {
      const source = loadSource(nodeScript[1]);
      if (source === undefined) continue;
      const engines = enginesForScriptSource(source);
      for (const engine of engines.required) required.add(engine);
      for (const engine of engines.optional) optional.add(engine);
    }
  }
  for (const engine of [...optional]) {
    if (envValues.has(engine)) {
      optional.delete(engine);
      required.add(engine);
    }
  }
  return { required, optional, envValues };
}

export function parseInstallCommand(command) {
  const match =
    /(?:npx\s+(?:--\S+\s+)*)?(?:\.\/)?(node_modules\/\.bin\/playwright|playwright)(?:@([\w.-]+))?\s+install\b([^\n&|;]*)/u.exec(
      command,
    );
  if (match === null) return null;
  const [, binary, versionSpec, rest] = match;
  const tokens = rest.split(/\s+/u).filter((token) => token.length > 0);
  const engines = tokens.filter((token) => INSTALLABLE_ENGINES.includes(token));
  return {
    localBinary: binary === "node_modules/.bin/playwright",
    versionSpec: versionSpec ?? null,
    withDeps: tokens.includes("--with-deps"),
    // A bare `playwright install` installs every bundled engine but never the
    // `chrome` channel.
    engines: engines.length > 0 ? engines : [...PLAYWRIGHT_ENGINES],
  };
}

function installCoverage(steps, upto, lockVersion) {
  const covered = new Map();
  let sawNpmCi = false;
  for (let index = 0; index < upto; index += 1) {
    const command = steps[index].run;
    if (typeof command !== "string") continue;
    if (/\bnpm\s+ci\b/u.test(command)) sawNpmCi = true;
    const install = parseInstallCommand(command);
    if (install === null) continue;
    const versionMatched =
      install.versionSpec === null
        ? install.localBinary && sawNpmCi
        : install.versionSpec === lockVersion;
    for (const engine of install.engines) {
      covered.set(engine, {
        step: index,
        versionMatched,
        withDeps: install.withDeps,
      });
    }
  }
  return covered;
}

export function auditWorkflow({
  workflowText,
  jobName,
  scripts,
  loadSource,
  lockVersion,
}) {
  const steps = parseWorkflowSteps(workflowText, jobName);
  const violations = [];
  const requirements = [];
  for (const step of steps) {
    if (typeof step.run !== "string") continue;
    if (parseInstallCommand(step.run) !== null) continue;
    const engines = resolveCommandEngines(step.run, scripts, loadSource);
    if (engines.required.size === 0) continue;
    requirements.push({
      step: step.index,
      command: step.run,
      engines: [...engines.required].sort(),
    });
    const covered = installCoverage(steps, step.index, lockVersion);
    for (const engine of [...engines.required].sort()) {
      const entry = covered.get(engine);
      if (entry === undefined) {
        violations.push(
          `step ${step.index} (${step.run.trim()}) launches ${engine} but no earlier step installs it`,
        );
        continue;
      }
      if (!entry.versionMatched) {
        violations.push(
          `step ${step.index} (${step.run.trim()}) relies on an install of ${engine} that is not pinned to the lockfile version ${lockVersion}`,
        );
      }
      if (!entry.withDeps) {
        violations.push(
          `step ${step.index} (${step.run.trim()}) relies on an install of ${engine} without --with-deps`,
        );
      }
    }
  }
  return { steps, requirements, violations };
}

export function findBrowserCacheStep(steps) {
  return steps.find(
    (step) =>
      typeof step.uses === "string" &&
      step.uses.startsWith("actions/cache@") &&
      typeof step.with === "string" &&
      /ms-playwright/u.test(step.with),
  );
}
