import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  auditWorkflow,
  enginesForScriptSource,
  findBrowserCacheStep,
  parseInstallCommand,
  parseWorkflowSteps,
  readLockPlaywrightVersion,
  resolveCommandEngines,
} from "./ci-browser-requirements.mjs";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(repository, relative), "utf8");
const workflowText = read(".github/workflows/ci.yml");
const scripts = JSON.parse(read("package.json")).scripts;
const lockVersion = readLockPlaywrightVersion(
  JSON.parse(read("package-lock.json")),
);
const loadSource = (relative) => {
  try {
    return read(relative);
  } catch {
    return undefined;
  }
};

test("the lockfile pins one Playwright version", () => {
  assert.match(lockVersion, /^\d+\.\d+\.\d+/u);
});

const syntheticImport = (names) =>
  ["import", `{ ${names} }`, 'from "playwright";'].join(" ");

test("engine detection distinguishes bundled engines and system Chrome", () => {
  const bundled = enginesForScriptSource(
    syntheticImport("chromium, firefox") +
      " chromium.launch({}); firefox.launch({});",
  );
  assert.deepEqual([...bundled.required].sort(), ["chromium", "firefox"]);
  const system = enginesForScriptSource(
    syntheticImport("chromium") +
      " const executablePath = findChromeExecutable(); chromium.launch({ executablePath });",
  );
  assert.deepEqual([...system.required], ["chrome"]);
});

test("an explicit engine environment switch promotes the optional engine", () => {
  const source =
    syntheticImport("chromium, webkit") +
    ' (process.env.BROWSER === "webkit" ? webkit : chromium).launch({});';
  const engines = resolveCommandEngines(
    "npm run sample",
    { sample: "BROWSER=webkit node scripts/sample.mjs" },
    () => source,
  );
  assert.ok(engines.required.has("webkit"));
});

test("official baseline uses its declared browser engine", () => {
  assert.ok(
    resolveCommandEngines(
      "npm run test:official-web:browser",
      scripts,
      loadSource,
    ).required.has("chromium"),
  );
});

test("install commands are parsed with their engines and version pin", () => {
  assert.deepEqual(
    parseInstallCommand("npx playwright install --with-deps firefox"),
    {
      localBinary: false,
      versionSpec: null,
      withDeps: true,
      engines: ["firefox"],
    },
  );
  assert.deepEqual(
    parseInstallCommand(
      "./node_modules/.bin/playwright install --with-deps chrome",
    ),
    {
      localBinary: true,
      versionSpec: null,
      withDeps: true,
      engines: ["chrome"],
    },
  );
  assert.deepEqual(parseInstallCommand("npm run check"), null);
});

test("every CI step that launches a browser is preceded by a matching install", () => {
  const audit = auditWorkflow({
    workflowText,
    jobName: "check",
    scripts,
    loadSource,
    lockVersion,
  });
  assert.ok(
    audit.requirements.length > 0,
    "the workflow must exercise at least one browser gate",
  );
  assert.deepEqual(audit.violations, []);
});

test("Playwright browsers are cached by the lockfile hash", () => {
  const steps = parseWorkflowSteps(workflowText, "check");
  const cache = findBrowserCacheStep(steps);
  assert.ok(cache !== undefined, "no actions/cache step for ms-playwright");
  assert.match(cache.with, /hashFiles\('package-lock\.json'\)/u);
  const install = steps.findIndex(
    (step) =>
      typeof step.run === "string" && parseInstallCommand(step.run) !== null,
  );
  assert.ok(
    cache.index < install,
    "the cache must be restored before installing",
  );
});

test("CI builds and checks official source without the retired console", () => {
  const commands = parseWorkflowSteps(workflowText, "check")
    .map((step) => step.run ?? "")
    .join("\n");
  for (const gate of [
    "build:official-web",
    "test:official-web:browser",
    "build:official-web:channel",
    "test:official-web:channel",
  ]) {
    assert.ok(commands.includes(`npm run ${gate}`), gate);
  }
  assert.ok(!commands.includes("npm run test:web:"));
  assert.ok(!commands.includes("npm run test:console:"));
});

test("CI fetches the historical source used by the fixed efficiency baseline", () => {
  const checkout = workflowText.match(
    /- uses: actions\/checkout@[^\n]+\n(?<options>(?:[ ]{8,}[^\n]*\n)*)/u,
  );
  assert.ok(checkout, "CI checkout step is required");
  assert.match(
    checkout.groups.options,
    /fetch-depth: 0/u,
    "fixed historical workload must be available to free baseline tests",
  );
});
