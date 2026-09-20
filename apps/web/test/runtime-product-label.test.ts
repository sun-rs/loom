import assert from "node:assert/strict";
import test from "node:test";
import * as presentation from "../src/agent-runtime-presentation.ts";

test("Computer labels use exact executable identities and preserve unknown names", () => {
  for (const [executable, expected] of [
    ["codex", "Codex CLI"],
    ["/opt/bin/claude", "Claude Code"],
    ["kimi", "Kimi Code"],
    ["C:\\bin\\opencode.exe", "OpenCode"],
    ["my-codex-proxy", "Custom runtime"],
  ])
    assert.equal(
      presentation.runtimeProductLabel({
        executable: executable!,
        displayName: "Custom runtime",
      }),
      expected,
    );
});

test("versioned executables use the authenticated inventory CLI identity", () => {
  assert.equal(
    presentation.runtimeProductLabel({
      cliId: "kimi",
      executable: "/opt/kimi-code/dist/main.mjs",
      displayName: "Kimi CLI · native ACP",
    }),
    "Kimi Code",
  );
  assert.equal(
    presentation.runtimeProductLabel({
      cliId: "claude",
      executable: "/home/user/.local/share/claude/versions/2.1.263",
      displayName: "Claude Code · native stream-json",
    }),
    "Claude Code",
  );
});

test("legacy generated runtime captions lose only the known transport suffix", () => {
  assert.equal(
    presentation.runtimeProductName("Codex · native app-server"),
    "Codex CLI",
  );
  assert.equal(
    presentation.runtimeProductName("Claude Code · native stream-json"),
    "Claude Code",
  );
  assert.equal(
    presentation.runtimeProductName("Kimi CLI · native ACP"),
    "Kimi Code",
  );
  assert.equal(
    presentation.runtimeProductName("OpenCode · native local server"),
    "OpenCode",
  );
  assert.equal(
    presentation.runtimeProductName("Custom · research"),
    "Custom · research",
  );
});
