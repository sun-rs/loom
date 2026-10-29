import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rolePresentation } from "../../frontends/raft/loom/role-profile-values.ts";
test("sidebar uses short names from verified Host CLI identity without changing the runtime catalog", () => {
  for (const [cliId, displayName, expected] of [
    ["codex", "Codex CLI", "Codex"],
    ["claude", "Claude Code", "Claude"],
    ["kimi", "Kimi Code", "Kimi"],
    ["opencode", "OpenCode", "OpenCode"],
    ["agy", "Antigravity", "Agy"],
    ["pi", "Pi", "Pi"],
  ]) {
    const runtime = {
      cliId,
      displayName,
      runtimeOfferId: "opaque-offer",
      modelBindingDescriptors: [],
    };
    const config = { runtimeOfferId: "opaque-offer", modelIntent: {} } as any;
    assert.equal(
      rolePresentation(config, { runtimes: [runtime] } as any).runtimeLabel,
      expected,
    );
    assert.equal(runtime.displayName, displayName);
    assert.equal(
      rolePresentation({ ...config, runtimeOfferId: "other" }, {
        runtimes: [runtime],
      } as any).runtimeLabel,
      undefined,
    );
  }
});
test("scroll frame delegates horizontal list geometry to native list cells and section recipes", () => {
  const frame = readFileSync(
    "frontends/raft/loom/ChatSidebarFrame.tsx",
    "utf8",
  );
  const scroll = frame.slice(
    frame.indexOf("scrollbar-quiet"),
    frame.indexOf("data-testid={scrollTestId}"),
  );
  assert.doesNotMatch(scroll, /\bpx-\d+\b|paddingInline/);
  const recipe = readFileSync(
    "frontends/raft/node_modules/raft-ui/dist/lib/list-cell.mjs",
    "utf8",
  );
  assert.match(recipe, /--cell-inset-x:8px/);
  assert.match(recipe, /--cell-pad-x:12px/);
});
