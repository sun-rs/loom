import assert from "node:assert/strict";
import test from "node:test";

import { gateReplyTransport } from "../../../scripts/cli-efficiency/reply-transport.mjs";
import { selectRuntimeReplyTransport } from "../src/reply-transport-policy.ts";

const reviewedEntries = [
  ["warm", "codex-app-server/v1", "LOOM_CODEX_NATIVE_FINAL_TRIAL"],
  ["warm", "claude-stream-json/v1", "LOOM_CLAUDE_NATIVE_FINAL_TRIAL"],
  ["warm", "opencode-server/v1", "LOOM_OPENCODE_NATIVE_FINAL_TRIAL"],
  ["cold", "kimi-acp/v1", "LOOM_KIMI_NATIVE_FINAL_TRIAL"],
  ["cold", "pi-print-json/v1", "LOOM_PI_NATIVE_FINAL_TRIAL"],
];

test("new source installations adopt reviewed entries without promoting standalone packaging", () => {
  for (const [entry, adapterKind, flag] of reviewedEntries) {
    const input = { entry, adapterKind, environment: {} };
    assert.equal(
      selectRuntimeReplyTransport({ ...input, standalone: false }),
      "native-final",
      adapterKind,
    );
    assert.equal(
      selectRuntimeReplyTransport({ ...input, standalone: true }),
      "worker",
      adapterKind,
    );
    // Explicit opt-ins retain their prior semantics, including lower-level
    // packaging errors; the policy never pretends to package an adapter.
    assert.equal(
      selectRuntimeReplyTransport({
        ...input,
        standalone: true,
        environment: { [flag]: "1" },
      }),
      "native-final",
    );
  }
  for (const standalone of [false, true]) {
    for (const entry of ["cold", "warm"]) {
      assert.equal(
        selectRuntimeReplyTransport({
          entry,
          adapterKind: "future-cli/v1",
          environment: Object.fromEntries(
            reviewedEntries.map(([, , flag]) => [flag, "1"]),
          ),
          standalone,
        }),
        "worker",
      );
    }
    assert.equal(
      selectRuntimeReplyTransport({
        entry: "cold",
        adapterKind: "codex-exec/v1",
        environment: {},
        standalone,
      }),
      "worker",
    );
    assert.equal(
      selectRuntimeReplyTransport({
        entry: "cold",
        adapterKind: "agy-print-json/v1",
        environment: {},
        standalone,
      }),
      "native-final",
    );
  }
});

test("existing benchmark arms stay explicit when product defaults change", () => {
  const worker = gateReplyTransport("codex", "worker").environment;
  for (const [entry, adapterKind] of reviewedEntries) {
    assert.equal(
      selectRuntimeReplyTransport({
        entry,
        adapterKind,
        environment: worker,
        standalone: false,
      }),
      "worker",
      adapterKind,
    );
  }
  for (const [provider, entry, adapterKind] of [
    ["codex", "warm", "codex-app-server/v1"],
    ["claude", "warm", "claude-stream-json/v1"],
    ["opencode", "warm", "opencode-server/v1"],
    ["kimi", "cold", "kimi-acp/v1"],
  ]) {
    const environment = gateReplyTransport(
      provider,
      "native-final",
    ).environment;
    assert.equal(
      selectRuntimeReplyTransport({
        entry,
        adapterKind,
        environment,
        standalone: false,
      }),
      "native-final",
    );
    for (const [otherEntry, otherKind] of reviewedEntries) {
      if (otherKind === adapterKind) continue;
      assert.equal(
        selectRuntimeReplyTransport({
          entry: otherEntry,
          adapterKind: otherKind,
          environment,
          standalone: false,
        }),
        "worker",
        `${provider} must not change ${otherKind}`,
      );
    }
  }
});
