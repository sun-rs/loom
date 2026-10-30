import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adaptNativeCapabilities } from "../../frontends/raft/adapter123/policy.ts";
test("Loom omits incompatible Agent tabs through one explicit capability seam; other native presentation remains intact", () => {
  const path =
      "frontends/raft/upstream/web-1.21.23/packages/web/src/components/agent/AgentDetailPanel.tsx",
    code = readFileSync(path, "utf8"),
    out = adaptNativeCapabilities(code, "/" + path);
  assert.notEqual(out, code);
  assert.equal(
    out
      .replace(
        '\n      // Loom has no Raft-managed MCP, integrations, reminders or global Agent session.\n      if (tab !== "profile" && tab !== "activity") return false;',
        "",
      )
      .replace(
        'import {RoleInstructions as LoomRoleInstructions} from "loom:role-profile";\n',
        "",
      )
      .replace("          <LoomRoleInstructions agent={agent as any} />\n", "")
      .replace('import LoomRoleInstances from "loom:role-instances";\n', "")
      .replace("          <LoomRoleInstances agent={agent as any} />\n", "")
      .replace(
        'import {InstanceStartStop as LoomInstanceStartStop} from "loom:role-lifecycle";\n',
        "",
      )
      .replace(
        "<LoomInstanceStartStop agentId={agent.id} onShowStopConfirm={openStopConfirm} />",
        "<AgentStartStopButton agentId={agent.id} onShowStopConfirm={openStopConfirm} />",
      )
      .replace(
        'const isActive = !(agent as any).loomRoleId && (displayState.isOnline || agent.status === "active");',
        'const isActive = displayState.isOnline || agent.status === "active";',
      ),
    code,
  );
  assert.equal(
    adaptNativeCapabilities('const css="p-6";', "/x/MessageItem.tsx"),
    'const css="p-6";',
  );
  assert.throws(
    () =>
      adaptNativeCapabilities(
        "changed",
        "/components/agent/AgentDetailPanel.tsx",
      ),
    /seam changed/,
  );
});
test("Role prompt is a named extension slot and config edits never restart live instances", () => {
  const path = "/components/agent/AgentDetailPanel.tsx",
    code = readFileSync(
      "frontends/raft/upstream/web-1.21.23/packages/web/src" + path,
      "utf8",
    ),
    out = adaptNativeCapabilities(code, path);
  assert.ok(out.includes("<LoomRoleInstructions agent={agent as any} />"));
  assert.ok(out.includes("const isActive = !(agent as any).loomRoleId"));
});
test("native local creation is not blocked by an unrelated Raft subscription quota", () => {
  for (const name of [
    "agent/CreateAgentDialog",
    "channel/CreateChannelDialog",
  ]) {
    const path = "/components/" + name + ".tsx",
      code = readFileSync(
        "frontends/raft/upstream/web-1.21.23/packages/web/src" + path,
        "utf8",
      );
    const adapted = adaptNativeCapabilities(code, path),
      assignment = adapted.match(/const atLimit = ([^;]+);/);
    assert.ok(assignment);
    const atLimit = Function(
      "agentCapacityLimitState",
      "maxChannels",
      "channels",
      "return " + assignment[1],
    )({ reached: true }, 1, [{}, {}]);
    assert.equal(
      atLimit,
      false,
      "Loom capacity cannot come from a Raft cloud account",
    );
  }
});
test("native preference writes carry the exact displayed revision without changing native controls", () => {
  for (const [name, expected] of [
    ["layout/Sidebar", 1],
    ["message/ChatPanel", 2],
    ["settings/SettingsPanel", 1],
  ] as const) {
    const path = "/components/" + name + ".tsx",
      code = readFileSync(
        "frontends/raft/upstream/web-1.21.23/packages/web/src" + path,
        "utf8",
      ),
      out = adaptNativeCapabilities(code, path);
    assert.equal((out.match(/loomPrefsVersion:/g) ?? []).length, expected);
    assert.equal(out.replaceAll(/\n\s*loomPrefsVersion: [^,\n]+,/g, ""), code);
  }
});
