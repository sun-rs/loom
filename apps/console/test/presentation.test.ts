import assert from "node:assert/strict";
import test from "node:test";
import { isTestRecord } from "../src/presentation.ts";

test("recognizable acceptance records can be hidden without treating ordinary names as tests", () => {
  for (const name of [
    "e2e-discuss-20261003t051608z",
    "Smoke Codex",
    "P95 Codex A",
    "p97-held-repair",
    "console-gate-fixture",
    "disc-astra",
  ]) {
    assert.equal(isTestRecord(name), true, name);
  }
  for (const name of [
    "产品设计",
    "测试方案讨论",
    "Latest research",
    "Smokehouse",
    "P95 latency analysis",
    "Alpha",
  ]) {
    assert.equal(isTestRecord(name), false, name);
  }
});
