import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  adaptiveLayout,
  adaptLayoutMedia,
  layoutQueries,
} from "../../frontends/raft/loom/adaptive-layout.ts";
test("native touch layout changes panes at 840, never density; fine-pointer desktop retains 768", () => {
  for (const width of [390, 767, 768, 820, 839])
    assert.equal(adaptiveLayout(width, true).dual, false);
  for (const width of [840, 1024, 1200, 1440])
    assert.equal(adaptiveLayout(width, true).dual, true);
  assert.equal(adaptiveLayout(768, false).dual, true);
  assert.equal(adaptiveLayout(767, false).dual, false);
  assert.equal(adaptiveLayout(1440, true).compactDensity, true);
  assert.equal(adaptiveLayout(1440, false).compactDensity, false);
});
test("CSS media and JS queries share the same policy; unrelated breakpoints and pointer tests retained", () => {
  assert.equal(adaptLayoutMedia("(width >= 48rem)"), layoutQueries.dual);
  assert.equal(adaptLayoutMedia("(max-width: 767px)"), layoutQueries.single);
  assert.equal(adaptLayoutMedia("(max-width: 767.98px)"), layoutQueries.single);
  assert.equal(
    adaptLayoutMedia("(width < 48rem) and (pointer: coarse)"),
    `${layoutQueries.single} and (pointer: coarse)`,
  );
  assert.equal(adaptLayoutMedia("(width >= 80rem)"), "(width >= 80rem)");
});
test("layout changes do not alter explicit task or font choices", () => {
  const tasks = readFileSync("frontends/raft/loom/TasksPage.tsx", "utf8");
  assert.match(tasks, /useMediaQuery\(layoutQueries.compactDensity\)/);
  assert.match(tasks, /params.get\("taskView"\) === "board"/);
  const mobile = readFileSync("frontends/raft/loom/mobile.css", "utf8");
  assert.match(mobile, /@media \(max-width: 767px\), \(pointer: coarse\)/);
});

test("native source thresholds and CSS third-pane admission stay synchronized", async () => {
  const { readAdaptiveContract } =
    await import("./mobile-adaptive-contract.mjs");
  const contract = readAdaptiveContract(
    "frontends/raft/upstream/raft-mobile-source",
  );
  assert.equal(adaptiveLayout(contract.dualPaneMinimum - 1, true).dual, false);
  assert.equal(adaptiveLayout(contract.dualPaneMinimum, true).dual, true);
  const css = readFileSync("frontends/raft/loom/mobile.css", "utf8");
  assert.ok(
    css.includes(
      `@media (pointer: coarse) and (min-width: ${contract.sideThread.windowMinimum}px)`,
    ),
  );
  assert.ok(
    css.includes(
      `@container thread-layout (min-width: ${contract.sideThread.mainMinimum + contract.sideThread.divider + contract.sideThread.column}px)`,
    ),
  );
  assert.ok(css.includes(`min-width: ${contract.sideThread.mainMinimum}px`));
  assert.ok(css.includes(`width: ${contract.sideThread.column}px`));
});
