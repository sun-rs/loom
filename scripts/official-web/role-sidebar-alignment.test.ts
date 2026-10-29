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
  const start = frame.indexOf("className={`${SIDEBAR_SCROLL_139_CLASS}");
  assert.ok(start >= 0, "the native scroll surface is actually bound");
  const scroll = frame.slice(
    start,
    frame.indexOf("data-testid={scrollTestId}", start),
  );
  assert.doesNotMatch(scroll, /\bpx-\d+\b|paddingInline/);
  const recipe = readFileSync(
    "frontends/raft/node_modules/raft-ui/dist/lib/list-cell.mjs",
    "utf8",
  );
  assert.match(recipe, /--cell-inset-x:8px/);
  assert.match(recipe, /--cell-pad-x:12px/);
});
test("both Role sections use native disclosure semantics and matching action footprints", () => {
  const text = readFileSync("frontends/raft/loom/RoleWorkspace.tsx", "utf8");
  assert.match(text, /aria-expanded=\{showRoles\}/);
  assert.match(text, /aria-expanded=\{showDeleted\}/);
  assert.match(text, /data-testid="role-section-toggle"/);
  assert.match(text, /data-testid="deleted-role-section-toggle"/);
  assert.doesNotMatch(text, /SidebarSectionDisclosure render=\{<div/);
  assert.match(text, /<RefreshCw[^>]+className="size-3\.5"/);
});
test("historical Web138 geometry remains reproducible but is absent from the active Role binding", async () => {
  const { generateRoleSidebarGeometry } =
    await import("./generate-role-sidebar-geometry.mjs");
  assert.equal(
    readFileSync(
      "frontends/raft/loom/OfficialRoleSidebarGeometry.generated.ts",
      "utf8",
    ),
    generateRoleSidebarGeometry(),
  );
  const source = generateRoleSidebarGeometry();
  assert.match(source, /paddingInlineStart:8\+1\.5/);
  assert.match(source, /paddingInline:8/);
  assert.doesNotMatch(
    readFileSync("frontends/raft/loom/RoleWorkspace.tsx", "utf8"),
    /OfficialRoleSidebarGeometry/,
  );
});
