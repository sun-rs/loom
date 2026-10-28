import assert from "node:assert/strict";
const flags = {
  codex: "LOOM_CODEX_NATIVE_FINAL_TRIAL",
  kimi: "LOOM_KIMI_NATIVE_FINAL_TRIAL",
  claude: "LOOM_CLAUDE_NATIVE_FINAL_TRIAL",
  opencode: "LOOM_OPENCODE_NATIVE_FINAL_TRIAL",
};
// A benchmark arm must not silently inherit or omit a reply transport switch.
// Keep both arms explicit even when product-daemon defaults change.
export function gateReplyTransport(provider, mode = "worker") {
  assert.ok(Object.hasOwn(flags, provider), "Unknown reply transport provider");
  assert.ok(
    ["worker", "native-final"].includes(mode),
    "Unknown reply transport mode",
  );
  const environment = Object.fromEntries(
    [
      ...Object.values(flags),
      "LOOM_CODEX_EXEC_NATIVE_FINAL_TRIAL",
      "LOOM_PI_NATIVE_FINAL_TRIAL",
      "LOOM_CODEX_FINAL_OUTPUT_TRIAL",
      "LOOM_OPENCODE_FINAL_OUTPUT_TRIAL",
    ].map((k) => [k, "0"]),
  );
  if (mode === "native-final") environment[flags[provider]] = "1";
  return { mode, environment };
}
