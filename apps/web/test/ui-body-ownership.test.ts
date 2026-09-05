import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("entity cards have one visual owner and no runtime/identity inference", () => {
  const card = read("packages/ui-web/src/neo-brutalist/entity-card.tsx");
  assert.doesNotMatch(card, /fetch\(|localStorage|client-sdk|runtimeAvailable/);
  assert.match(card, /disabled=\{disabled\}/);
  const binding = read("apps/web/src/components/agent-entity-card.tsx");
  assert.match(binding, /agentPresencePresentation\(agent\)/);
  assert.match(binding, /showStatus=\{false\}/);
  for (const consumer of ["agent-directory-pane", "workspace-catalog-panes"])
    assert.match(
      read(`apps/web/src/components/${consumer}.tsx`),
      /<AgentEntityCard/,
    );
  for (const file of ["computer-directory", "agent-directory"])
    assert.doesNotMatch(
      read(`apps/web/src/${file}.css`),
      /\.(?:rah-computer-agent-list > button|rah-agent-created-row)[^{}]*\{/,
    );
});

test("empty states declare context; pages cannot override the shared body geometry", () => {
  const empty = read("packages/ui-web/src/neo-brutalist/empty-state.tsx");
  assert.match(empty, /"search" \| "profile" \| "task" \| "activity"/);
  assert.match(empty, /"fill" \| "section"/);
  assert.doesNotMatch(empty, /fetch\(|localStorage|client-sdk/);
  const discovery = read("apps/web/src/components/global-discovery.tsx");
  assert.doesNotMatch(discovery, /function Empty\(/);
  assert.doesNotMatch(discovery, /className="empty-state"/);
  assert.doesNotMatch(
    discovery,
    /\(result\.data\?\.rooms\.length \|\| result\.data\?\.principals\.length\) &&/,
    "a zero-length JSX condition must not render the number 0",
  );
  assert.match(discovery, /context="task"/);
  assert.match(discovery, /context="activity"/);
  assert.match(discovery, /context="search"/);
  const conversation = read("apps/web/src/components/conversation-panes.tsx");
  assert.doesNotMatch(conversation, /className="tasks-empty"/);
  assert.match(conversation, /context="task"/);
  const primitives = read(
    "packages/ui-tokens/src/neo-brutalist/body-primitives.css",
  );
  for (const token of [
    "--raft-tasks-empty-padding",
    "--raft-tasks-empty-icon-size",
    "--raft-tasks-empty-title-size",
    "--raft-tasks-empty-title-line",
    "--raft-tasks-empty-body-size",
    "--raft-tasks-empty-body-line",
  ])
    assert.match(primitives, new RegExp(token));
  assert.doesNotMatch(
    read("packages/ui-tokens/src/neo-brutalist/search.css"),
    /\.empty-(?:state|icon)/,
  );
  assert.doesNotMatch(
    read("apps/web/src/product.css"),
    /\.tasks-empty(?:\s|\{|\.)/,
  );
  assert.doesNotMatch(
    read("apps/web/src/global-discovery.css"),
    /\.rah-search-home\s*\{/,
  );
  assert.doesNotMatch(
    read("apps/web/src/agent-directory.css"),
    /\.rah-agent-activity-pane > \.rah-agent-capability-pane\s*\{/,
  );
  const agent = read("apps/web/src/components/agent-directory-pane.tsx");
  assert.match(agent, /description="启动 Agent 以查看其活动日志。"/);
});
