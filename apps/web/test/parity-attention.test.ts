import assert from "node:assert/strict";
import test from "node:test";
import { createLatestRequest } from "../src/latest-request.ts";
import {
  agentConnectionLabel,
  computerAttention,
  computerStatusLabel,
  visibleNavigationDot,
} from "../src/attention-presentation.ts";

test("Agent presence uses Host connection separately from CLI availability and pause", () => {
  const agent = {
    state: "enabled",
    runtimeAvailable: true,
    connectionStatus: "online",
  } as const;
  assert.equal(
    agentConnectionLabel(agent),
    "状态未知",
    "installed CLI and connected Host are not Agent online evidence",
  );
  assert.equal(
    agentConnectionLabel({ ...agent, connectionStatus: "offline" }),
    "离线",
  );
  assert.equal(
    agentConnectionLabel({ ...agent, connectionStatus: "unknown" }),
    "状态未知",
  );
  assert.equal(
    agentConnectionLabel({ ...agent, runtimeAvailable: false }),
    "状态未知",
  );
  assert.equal(agentConnectionLabel({ ...agent, state: "disabled" }), "已暂停");
});

test("navigation invalidates success, failure and pending completion, even if transport ignores Abort", () => {
  const gate = createLatestRequest();
  let location = "activity";
  const first = gate.begin(() => location === "activity");
  location = "settings";
  assert.equal(first.current(), false);
  assert.equal(
    first.owns(),
    true,
    "invalid navigation can still release its own pending state",
  );
  location = "activity";
  const second = gate.begin();
  assert.equal(
    first.owns(),
    false,
    "old completion must not release a newer action's pending state",
  );
  assert.equal(first.signal.aborted, true);
  assert.equal(first.current(), false);
  assert.equal(second.current(), true);
  gate.cancel();
  assert.equal(second.current(), false);
});
test("Activity dot hiding is visual, not read; system attention is not an InputRequest", () => {
  assert.equal(visibleNavigationDot(true, true), false);
  assert.equal(visibleNavigationDot(true, false), true);
  assert.equal(computerStatusLabel(undefined), "状态未知");
  assert.equal(
    computerStatusLabel({ status: "draining" } as never),
    "正在停止",
  );
  assert.deepEqual(computerAttention(undefined, undefined), []);
  const computer = {
    status: "offline",
    instanceId: "g1",
    displayName: "Mac",
    observedAt: "first",
  } as never;
  const first = computerAttention("host", computer);
  assert.equal(first.length, 1);
  assert.equal(
    computerAttention("host", { ...computer, observedAt: "second" })[0]?.id,
    first[0]?.id,
  );
  assert.notEqual(
    computerAttention("host", {
      ...computer,
      lastSeenAt: "new-heartbeat-before-new-outage",
    })[0]?.id,
    first[0]?.id,
  );
});
