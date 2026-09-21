import assert from "node:assert/strict";
import test from "node:test";
import {
  readDiscoveryWidth,
  discoveryWidthPolicy,
} from "../src/discovery-width.ts";

test("search/activity share preferences, keep wide and compact independent, migrate without writing", () => {
  const values = new Map([
    ["rah:activity-width", "600"],
    ["rah:activity-compact-width", "440"],
  ]);
  const storage = { getItem: (key: string) => values.get(key) ?? null };
  assert.equal(readDiscoveryWidth(storage, false), 600);
  assert.equal(readDiscoveryWidth(storage, true), 440);
  values.set("rah:search-width", "520");
  assert.equal(readDiscoveryWidth(storage, false), 520);
  values.set("rah:search-width", "NaN");
  assert.equal(readDiscoveryWidth(storage, false), 600);
  assert.equal(values.size, 3);
});

test("discovery defaults and drag limits protect 320px body without changing preferred width", () => {
  assert.deepEqual(discoveryWidthPolicy(1440, false), {
    compact: false,
    min: 400,
    max: 720,
    defaultWidth: 560,
  });
  assert.deepEqual(discoveryWidthPolicy(1024, false), {
    compact: false,
    min: 400,
    max: 640,
    defaultWidth: 560,
  });
  assert.deepEqual(discoveryWidthPolicy(1023, false), {
    compact: true,
    min: 320,
    max: 480,
    defaultWidth: 320,
  });
  assert.equal(discoveryWidthPolicy(1440, true).defaultWidth, 320);
});
