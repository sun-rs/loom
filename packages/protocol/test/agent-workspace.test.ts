import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentWorkspaceFileSchema,
  AgentWorkspaceListRequestSchema,
  AgentWorkspaceListSchema,
  AgentWorkspaceRootsRequestSchema,
  AgentWorkspaceRootsSchema,
} from "../src/index.ts";

test("Agent workspace roots distinguish the persistent Agent workspace from the frozen runtime project", () => {
  assert.deepEqual(
    AgentWorkspaceRootsRequestSchema.parse({ agentId: "agent-1" }),
    { agentId: "agent-1" },
  );
  const roots = AgentWorkspaceRootsSchema.parse({
    defaultRootId: "agent-workspace",
    roots: [
      {
        label: "Agent 工作区",
        rootId: "agent-workspace",
        rootKind: "agent-workspace",
        rootPath: "/private/agents/alice",
        state: "ready",
      },
      {
        label: "RAH OS",
        rootId: "runtime-project",
        rootKind: "runtime-project",
        rootPath: "/work/rah_os",
        state: "ready",
      },
    ],
  });
  assert.equal(roots.roots[1]?.rootKind, "runtime-project");
  assert.throws(() =>
    AgentWorkspaceRootsSchema.parse({
      ...roots,
      defaultRootId: "missing",
    }),
  );
});

test("workspace list/read requests default to the Agent workspace and responses bind one root", () => {
  assert.deepEqual(
    AgentWorkspaceListRequestSchema.parse({
      agentId: "agent-1",
      includeHidden: false,
      path: "src",
    }),
    {
      agentId: "agent-1",
      includeHidden: false,
      path: "src",
      rootId: "agent-workspace",
    },
  );
  const listing = AgentWorkspaceListSchema.parse({
    entries: [],
    path: "src",
    rootId: "runtime-project",
    rootKind: "runtime-project",
    rootLabel: "RAH OS",
    rootPath: "/work/rah_os",
    state: "ready",
    truncated: false,
  });
  assert.equal(listing.rootId, "runtime-project");
  assert.throws(() =>
    AgentWorkspaceListRequestSchema.parse({
      agentId: "agent-1",
      includeHidden: false,
      path: "/etc",
      rootId: "runtime-project",
    }),
  );
  assert.throws(() =>
    AgentWorkspaceFileSchema.parse({
      content: "root:x",
      encoding: "utf-8",
      mimeType: "text/plain",
      path: "passwd",
      rootId: "unknown",
      rootKind: "runtime-project",
      rootLabel: "bad",
      size: 6,
    }),
  );
});
