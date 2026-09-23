import assert from "node:assert/strict";
import test from "node:test";
import {
  forkInstanceSessionBinding,
  replaceInstanceSessionBinding,
  requireInstanceSessionBinding,
} from "../src/instance-session-binding-policy.ts";

const current = {
  schemaVersion: 1 as const,
  instanceId: "instance-a",
  channelId: "channel-a",
  roleId: "reviewer",
  roleRevisionId: "reviewer-v1",
  hostId: "host-a",
  runtimeId: "codex" as const,
  providerSessionId: "native-a",
  bindingEpoch: 1,
};

test("continuation checks identity without mutating the native binding", () => {
  const original = structuredClone(current);
  assert.deepEqual(
    requireInstanceSessionBinding(current, { ...current }),
    current,
  );
  assert.deepEqual(current, original);
  for (const field of [
    "instanceId",
    "channelId",
    "roleId",
    "roleRevisionId",
    "hostId",
    "providerSessionId",
  ]) {
    assert.throws(
      () =>
        requireInstanceSessionBinding(current, {
          ...current,
          [field]: "other",
        }),
      /binding/,
    );
  }
  assert.throws(
    () =>
      requireInstanceSessionBinding(current, {
        ...current,
        runtimeId: "claude",
      }),
    /binding/,
  );
});

test("replacement preserves instance provenance, increments epoch and rejects stale proposals", () => {
  const replacement = replaceInstanceSessionBinding(
    current,
    current,
    "native-recovered",
  );
  assert.deepEqual(replacement, {
    ...current,
    providerSessionId: "native-recovered",
    bindingEpoch: 2,
  });
  assert.throws(
    () => requireInstanceSessionBinding(replacement, current),
    /binding/,
  );
  assert.throws(
    () => replaceInstanceSessionBinding(replacement, current, "native-late"),
    /binding/,
  );
  assert.deepEqual(current.providerSessionId, "native-a");
});

test("a replacement cannot reuse the old native ID or overflow its epoch", () => {
  assert.throws(
    () => replaceInstanceSessionBinding(current, current, "native-a"),
    /different/,
  );
  const exhausted = { ...current, bindingEpoch: Number.MAX_SAFE_INTEGER };
  assert.throws(
    () => replaceInstanceSessionBinding(exhausted, exhausted, "new"),
    /epoch/,
  );
});

test("fork creates a separate instance in the same channel with the source role snapshot", () => {
  const source = { ...current, bindingEpoch: 8 };
  const child = forkInstanceSessionBinding(
    source,
    source,
    "instance-b",
    "native-b",
  );
  assert.deepEqual(child, {
    ...current,
    instanceId: "instance-b",
    providerSessionId: "native-b",
  });
  const laterSource = replaceInstanceSessionBinding(
    current,
    current,
    "native-replacement",
  );
  assert.equal(child.providerSessionId, "native-b");
  assert.equal(laterSource.instanceId, current.instanceId);
  assert.deepEqual(current.providerSessionId, "native-a");
});

test("fork rejects same identity, same session, stale source and inherited authority fields", () => {
  assert.throws(
    () =>
      forkInstanceSessionBinding(current, current, "instance-a", "native-b"),
    /different/,
  );
  assert.throws(
    () =>
      forkInstanceSessionBinding(current, current, "instance-b", "native-a"),
    /different/,
  );
  assert.throws(
    () =>
      forkInstanceSessionBinding(
        current,
        { ...current, bindingEpoch: 2 },
        "instance-b",
        "native-b",
      ),
    /binding/,
  );
  for (const field of ["taskId", "accessToken", "leaseId"]) {
    assert.throws(() =>
      forkInstanceSessionBinding(
        { ...current, [field]: "must-not-copy" },
        current,
        "instance-b",
        "native-b",
      ),
    );
  }
});
