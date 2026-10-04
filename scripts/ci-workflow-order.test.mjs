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

test("engine detection separates bundled engines from a system Chrome", () => {
  const choice = enginesForScriptSource(
    read("scripts/test-choice-row-browser.mjs"),
  );
  assert.deepEqual([...choice.required].sort(), ["chromium", "firefox"]);

  const foundations = enginesForScriptSource(
    read("scripts/run-ui-foundation-browser-gate.mjs"),
  );
  assert.deepEqual([...foundations.required].sort(), ["chrome", "firefox"]);
  assert.equal(foundations.required.has("chromium"), false);

  const comparison = enginesForScriptSource(
    read("scripts/run-ui-comparison.mjs"),
  );
  assert.deepEqual([...comparison.required].sort(), ["chrome"]);

  // WebKit is reachable only through an explicit environment switch.
  const touch = enginesForScriptSource(
    read("scripts/test-sidebar-touch-browser.mjs"),
  );
  assert.equal(touch.required.has("chromium"), true);
  assert.equal(touch.optional.has("webkit"), true);
});

test("an environment switch in the npm script promotes the optional engine", () => {
  const engines = resolveCommandEngines(
    "npm run test:web:sidebar-touch",
    scripts,
    loadSource,
  );
  assert.equal(engines.required.has("webkit"), true);
});

test("npm run check reaches a bundled Chromium and Firefox launch", () => {
  const engines = resolveCommandEngines("npm run check", scripts, loadSource);
  assert.equal(engines.required.has("chromium"), true);
  assert.equal(engines.required.has("firefox"), true);
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

test("the rc mobile, task, menu and scroll gates run in CI", () => {
  const steps = parseWorkflowSteps(workflowText, "check");
  const commands = steps
    .map((step) => step.run)
    .filter((run) => typeof run === "string")
    .join("\n");
  for (const gate of [
    "test:web:mobile-navigation",
    "test:web:message-menu",
    "test:web:message-selection",
    "test:web:task-filter-scope",
    "test:web:scroll-ownership",
    "test:web:sidebar-touch",
  ]) {
    assert.match(
      commands,
      new RegExp(`npm run ${gate.replace(/:/gu, ":")}\\b`, "u"),
    );
  }
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
