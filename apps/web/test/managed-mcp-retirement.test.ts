import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { agentRouteFromSearch } from "../src/agent-route.ts";
import { navigationPresentation } from "../src/navigation-target.ts";
import type { NavigationTarget } from "@rah-os/protocol";

const webRoot = join(import.meta.dirname, "..");

test("retired Agent MCP links fall back to the same Agent profile", () => {
  assert.deepEqual(
    agentRouteFromSearch(
      "?surface=agents&agent=agent_definition_alice&agentTab=mcp",
    ),
    { agentId: "agent_definition_alice", tab: "profile" },
  );
});

test("an older typed Agent navigation target cannot reopen the retired tab", () => {
  const target = {
    kind: "agent",
    agentId: "agent_definition_alice",
    tab: "mcp",
  } as unknown as NavigationTarget;
  assert.equal(navigationPresentation(target).agentTab, "profile");
});

test("the shipped Web has no managed MCP entry, reader, or dedicated module", () => {
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:ts|tsx)$/.test(entry.name)) {
        assert.doesNotMatch(
          readFileSync(path, "utf8"),
          /managedMcp|ManagedMcp|managed-mcp|label:\s*"MCP"/u,
          path,
        );
      }
    }
  }
  visit(join(webRoot, "src"));
  assert.equal(
    existsSync(join(webRoot, "src/components/managed-mcp-settings.tsx")),
    false,
  );
  assert.equal(existsSync(join(webRoot, "src/agent-mcp-projection.ts")), false);
});

test("the local guide retains recovery and Agent setup without retired MCP setup", () => {
  const guide = readFileSync(
    join(webRoot, "public/help/local-workbench.html"),
    "utf8",
  );
  assert.doesNotMatch(guide, /managed-mcp\.json|id="mcp"|href="#mcp"/u);
  assert.match(guide, /id="recovery"/u);
  assert.match(guide, /id="agents"/u);
  assert.match(guide, /id="delivery"/u);
});
