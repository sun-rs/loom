import assert from "node:assert/strict";
import test from "node:test";
import { formatActivityRelativeTime } from "../src/activity-relative-time.ts";

const now = Date.parse("2026-09-10T12:00:00Z");
const ago = (milliseconds: number) =>
  new Date(now - milliseconds).toISOString();
test("Activity uses Raft minute/hour/day boundaries and rounding", () => {
  for (const [delta, expected] of [
    [0, "此刻"],
    [29_000, "此刻"],
    [31_000, "1 分钟前"],
    [59 * 60_000 + 59_000, "60 分钟前"],
    [60 * 60_000, "1 小时前"],
    [5 * 60 * 60_000, "5 小时前"],
    [24 * 60 * 60_000 - 1, "24 小时前"],
    [24 * 60 * 60_000, "昨天"],
    [4 * 24 * 60 * 60_000, "4 天前"],
    [-60 * 60_000, "1 小时后"],
  ] as const)
    assert.equal(formatActivityRelativeTime(ago(delta), now), expected);
  assert.equal(formatActivityRelativeTime("invalid", now), null);
  assert.equal(formatActivityRelativeTime("", now), null);
});
