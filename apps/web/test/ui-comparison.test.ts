import assert from "node:assert/strict";
import test from "node:test";
import {
  compareSample,
  validateComparisonPlan,
} from "../../../scripts/ui-comparison.mjs";
import { readFileSync } from "node:fs";

test("pairings are tied to the library behavior IDs; duplicate or missing scenarios fail closed", () => {
  const plan = JSON.parse(
    readFileSync("docs/design/ui-comparison-plan.json", "utf8"),
  );
  const official = JSON.parse(readFileSync(plan.officialCapture, "utf8"));
  const library = JSON.parse(
    readFileSync("packages/ui-tokens/neo-brutalist-library.json", "utf8"),
  );
  assert.deepEqual(validateComparisonPlan(plan, official, library), []);
  assert.ok(
    validateComparisonPlan({ ...plan, scenarios: [] }, official, library)
      .length,
    "a zero-scenario comparison must not pass without measuring anything",
  );
  assert.ok(
    validateComparisonPlan(
      { ...plan, scenarios: [...plan.scenarios, plan.scenarios[0]] },
      official,
      library,
    ).length,
  );
  assert.ok(
    validateComparisonPlan(plan, { ...official, samples: [] }, library).length,
  );
  const wrong = structuredClone(library);
  wrong.components.find((c: { id: string }) => c.id === "icon").behaviors = [
    "UI001",
  ];
  assert.ok(validateComparisonPlan(plan, official, wrong).length);
  assert.ok(
    validateComparisonPlan(
      {
        ...plan,
        scenarios: plan.scenarios.map((s: object) => ({
          ...s,
          route: "provider-run",
        })),
      },
      official,
      library,
    ).length,
    "comparison routes must not become arbitrary operation instructions",
  );
});

const environment = {
  width: 1440,
  height: 900,
  dpr: 1,
  fonts: "loaded",
  enabledTabs: ["聊天", "任务", "文件"],
};
const sample = { environment, observations: { header: { height: "62px" } } };
const pair = {
  id: "header",
  component: "panel-header",
  behavior: "UI001",
  properties: ["height"],
};
test("same prerequisites and values match; real differences remain visible", () => {
  assert.equal(compareSample(pair, sample, sample)[0].status, "matched");
  const changed = { ...sample, observations: { header: { height: "76px" } } };
  assert.equal(compareSample(pair, sample, changed)[0].status, "different");
});
test("missing facts, unloaded fonts and different viewports cannot pass", () => {
  for (const local of [
    undefined,
    { ...sample, observations: {} },
    { ...sample, observations: { header: { height: null } } },
    { ...sample, environment: { ...environment, width: 390 } },
    { ...sample, environment: { ...environment, fonts: "loading" } },
  ])
    assert.equal(compareSample(pair, sample, local)[0].status, "uncomparable");
});

test("disabled or reordered Tabs are different fixture prerequisites", () => {
  const local = {
    ...sample,
    environment: { ...environment, enabledTabs: ["聊天", "文件"] },
  };
  assert.equal(compareSample(pair, sample, local)[0].status, "uncomparable");
});
test("exceptions require exact expected values and a recorded reason", () => {
  const changed = { ...sample, observations: { header: { height: "76px" } } };
  const exception = {
    height: {
      official: "62px",
      local: "76px",
      reason: "ADR: mobile inspector",
    },
  };
  assert.equal(
    compareSample({ ...pair, exceptions: exception }, sample, changed)[0]
      .status,
    "approved-local-difference",
  );
  assert.equal(
    compareSample(
      {
        ...pair,
        exceptions: { height: { ...exception.height, local: "75px" } },
      },
      sample,
      changed,
    )[0].status,
    "different",
  );
});
test("only exact color aliases and transparent zero shadows are normalized", () => {
  const pair = {
    id: "action",
    component: "panel-header-action",
    behavior: "UI002",
    properties: ["color", "boxShadow"],
  };
  const a = {
    environment,
    observations: {
      action: {
        color: "oklch(0 0 0)",
        boxShadow:
          "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(20, 17, 17) 2px 2px 0px 0px",
      },
    },
  };
  const b = {
    environment,
    observations: {
      action: {
        color: "rgb(0, 0, 0)",
        boxShadow: "rgb(20, 17, 17) 2px 2px 0px 0px",
      },
    },
  };
  assert.deepEqual(
    compareSample(pair, a, b).map((x) => x.status),
    ["matched", "matched"],
  );
});
