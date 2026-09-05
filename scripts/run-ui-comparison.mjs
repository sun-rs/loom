import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { digest } from "./ui-behavior-registry.mjs";
import {
  checkLibrary,
  libraryInputs,
  libraryPath,
} from "./ui-library-contract.mjs";
import {
  captureComponents,
  comparedProperties,
  compareSample,
  pairs,
  validateComparisonPlan,
} from "./ui-comparison.mjs";
import {
  assertUiEvidenceInputSnapshot,
  snapshotUiEvidenceInputs,
  uiContractEvidenceInputPaths,
} from "./ui-evidence-inputs.mjs";

checkLibrary();
const planPath = process.argv[2] ?? "docs/design/ui-comparison-plan.json";
const plan = JSON.parse(readFileSync(planPath));
const bytes = readFileSync(plan.officialCapture);
assert.equal(
  digest(bytes),
  plan.officialCaptureSha256,
  "Official evidence changed: review before baseline update",
);
const official = JSON.parse(bytes);
assert.equal(
  official.kind,
  "official-live-capture",
  "A reconstruction is not official evidence",
);
const registry = JSON.parse(
  readFileSync("docs/product/ui-behavior-registry.json"),
);
const library = JSON.parse(readFileSync(libraryPath));
assert.deepEqual(validateComparisonPlan(plan, official, library), []);
for (const pair of pairs) {
  assert.ok(registry.behaviors.some((b) => b.id === pair.behavior));
  assert.ok(library.components.some((c) => c.id === pair.component));
}
const evidenceInputs = {
  extraPaths: [
    ...libraryInputs(),
    ...uiContractEvidenceInputPaths(),
    planPath,
    plan.officialCapture,
  ],
};
const inputs = snapshotUiEvidenceInputs(evidenceInputs);
const output = mkdtempSync(join(tmpdir(), "rah-ui-comparison-"));
const report = {
  schemaVersion: 1,
  kind: "official-capture-replay",
  officialCapturedAt: official.capturedAt,
  startedAt: new Date().toISOString(),
  scope: plan.scope,
  inputs,
  browser: null,
  results: [],
  samples: [],
  errors: [],
};
const fixture = await startShellFixture();
let browser;
try {
  browser = await chromium.launch({
    executablePath: await findChromeExecutable(),
    headless: true,
  });
  report.browser = browser.version();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => report.errors.push(String(e)));
  for (const scenario of plan.scenarios) {
    const expected = official.samples.find((s) => s.id === scenario.id);
    assert.ok(expected, `No official sample: ${scenario.id}`);
    await page.setViewportSize({
      width: expected.environment.width,
      height: expected.environment.height,
    });
    const settings = scenario.route === "settings-notifications";
    await page.goto(
      fixture.origin +
        (settings ? "/?surface=settings&settingsSection=notifications" : ""),
      { waitUntil: "domcontentloaded" },
    );
    const selectors = { ...plan.localSelectors, ...scenario.localSelectors };
    if (!settings) {
      await page
        .getByRole("tablist", { name: "对话内容" })
        .getByRole("tab", { name: "聊天", exact: true })
        .click();
    }
    await page.locator(selectors.header).waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const key of scenario.keys) await page.keyboard.press(key);
    // Wait for CSS transitions without freezing input or changing product state.
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      );
      await document.fonts.ready;
    });
    const sample = await page.evaluate(captureComponents, {
      selectors,
      properties: comparedProperties,
    });
    report.samples.push({ id: scenario.id, ...sample });
    for (const pair of pairs.filter((p) => scenario.pairs.includes(p.id)))
      report.results.push(
        ...compareSample(pair, expected, sample).map((r) => ({
          scenario: scenario.id,
          ...r,
        })),
      );
    await page.screenshot({ path: join(output, `${scenario.id}.png`) });
  }
  assertUiEvidenceInputSnapshot(inputs, {
    extraPaths: [
      ...libraryInputs(),
      ...uiContractEvidenceInputPaths(),
      planPath,
      plan.officialCapture,
    ],
  });
} catch (error) {
  report.errors.push(String(error));
} finally {
  await browser?.close();
  await fixture.close();
  report.finishedAt = new Date().toISOString();
  report.counts = Object.fromEntries(
    ["matched", "different", "approved-local-difference", "uncomparable"].map(
      (s) => [s, report.results.filter((r) => r.status === s).length],
    ),
  );
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(output, "report.md"),
    `# UI comparison (official capture replay)\n\nOfficial capture: ${official.capturedAt}. This is not a fresh official-site run.\n\n${plan.scope}\n\n| Scenario | Component / behavior | Property | Official | Local | Result |\n| --- | --- | --- | --- | --- | --- |\n` +
      report.results
        .map(
          (r) =>
            `| ${r.scenario} | ${r.component} / ${r.behavior} | ${r.property} | ${r.official ?? "missing"} | ${r.local ?? "missing"} | ${r.status} |`,
        )
        .join("\n") +
      `\n\nErrors: ${JSON.stringify(report.errors)}\n`,
  );
  process.stdout.write(
    JSON.stringify({ output, counts: report.counts, errors: report.errors }) +
      "\n",
  );
  for (const result of report.results.filter((r) => r.status !== "matched"))
    process.stdout.write(JSON.stringify(result) + "\n");
  if (
    report.errors.length ||
    report.counts.different ||
    report.counts.uncomparable
  )
    process.exitCode = 1;
}
