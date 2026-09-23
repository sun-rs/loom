import assert from "node:assert/strict";
import test from "node:test";
import { InstanceSessionBindingSchema } from "../src/instance-session-binding.ts";

const binding = {
  schemaVersion: 1,
  instanceId: "instance-a",
  channelId: "channel-a",
  roleId: "reviewer",
  roleRevisionId: "reviewer-v1",
  hostId: "host-a",
  runtimeId: "codex",
  providerSessionId: "opaque-native-session",
  bindingEpoch: 1,
};

test("instance binding preserves opaque native identity and frozen role provenance", () => {
  assert.deepEqual(InstanceSessionBindingSchema.parse(binding), binding);
});

test("model, effort and profile versions are not session identity fields", () => {
  for (const field of ["model", "effort", "runtimeProfileRevisionId"]) {
    assert.equal(
      InstanceSessionBindingSchema.safeParse({ ...binding, [field]: "changed" })
        .success,
      false,
    );
  }
});

test("bindings reject invalid epochs, empty identities and control characters", () => {
  for (const bindingEpoch of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(
      InstanceSessionBindingSchema.safeParse({ ...binding, bindingEpoch })
        .success,
      false,
    );
  }
  for (const field of [
    "instanceId",
    "channelId",
    "roleId",
    "roleRevisionId",
    "hostId",
    "providerSessionId",
  ]) {
    for (const invalid of ["", "  ", "unsafe\nvalue", "a".repeat(4097)]) {
      assert.equal(
        InstanceSessionBindingSchema.safeParse({ ...binding, [field]: invalid })
          .success,
        false,
      );
    }
  }
  assert.equal(
    InstanceSessionBindingSchema.safeParse({ ...binding, schemaVersion: 2 })
      .success,
    false,
  );
});
