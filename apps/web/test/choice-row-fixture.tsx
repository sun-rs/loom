import type { WorkspaceAgentView } from "@rah-os/ui-web";
import {
  ComposerMentionMenu,
  useComposerMention,
} from "../src/components/composer-mention.tsx";
import { useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { ChoiceRow } from "@rah-os/ui-web/neo-brutalist/choice-row";
import { DiscoveryFilter } from "../src/components/discovery-filter.tsx";
import "../src/product-styles.ts";
function Matrix({ nested = false }: { nested?: boolean }) {
  const [selected, setSelected] = useState(false);
  const [disabledActivations, setDisabledActivations] = useState(0);
  const [current, setCurrent] = useState(false);
  return (
    <section
      role={nested ? "dialog" : undefined}
      aria-label={nested ? "Nested fixture" : undefined}
    >
      <h2>{nested ? "弹窗内" : "基础页面"}</h2>
      <ChoiceRow
        profile="member-selection"
        selection="tint"
        selected={selected}
        onClick={() => setSelected(!selected)}
      >
        成员选择 {selected && "✓"}
      </ChoiceRow>
      <ChoiceRow profile="member-selection" disabled>
        禁用成员
      </ChoiceRow>
      <ChoiceRow
        as="div"
        profile="member-browse"
        role="button"
        tabIndex={0}
        aria-disabled="true"
        onClick={() => setDisabledActivations((n) => n + 1)}
        onKeyDown={() => setDisabledActivations((n) => n + 1)}
      >
        语义禁用成员
      </ChoiceRow>
      <output aria-label="禁用激活次数">{disabledActivations}</output>
      <ChoiceRow profile="member-browse">成员浏览</ChoiceRow>
      <ChoiceRow profile="property-option" aria-checked role="menuitemradio">
        负责人 ✓
      </ChoiceRow>
      <ChoiceRow
        profile="autocomplete"
        current={current}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setCurrent(true);
          if (e.key === "Escape") setCurrent(false);
        }}
      >
        自动补全
      </ChoiceRow>
      <ChoiceRow profile="autocomplete" current disabled>
        禁用当前候选
      </ChoiceRow>
    </section>
  );
}
const agents: WorkspaceAgentView[] = ["agent-a", "agent-b"].map((id) => ({
  participantId: id,
  agentId: id,
  handle: id,
  displayName: id,
  description: "Fixture only",
  role: "Assistant",
  state: "enabled",
  createdAt: "2026-09-14T00:00:00.000Z",
  createdBy: "owner",
  executionPolicyRevisionId: "fixture",
  skillRefs: [],
  runtimeAvailable: false,
  runtimeLabels: [],
  connectionStatus: "offline",
}));
const rankingFixture = location.search.includes("ranking");
const rankingAgents = Array.from({ length: 40 }, (_, i) => ({
  ...agents[0]!,
  participantId: `rank-${i}`,
  agentId: `rank-${i}`,
  handle: i === 0 ? "Parity" : i === 1 ? "parity" : `agent-${i}`,
  displayName: i === 2 ? "李云龙" : `Agent ${i}`,
  description: "documentation helper",
}));
function MentionFixture() {
  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mention = useComposerMention({
    agents: rankingFixture ? rankingAgents : agents,
    body,
    id: "fixture-mention",
    channels: [
      {
        roomId: "all",
        name: "all",
        kind: "channel",
        description: "General channel",
      },
      {
        roomId: "test",
        name: rankingFixture ? "研发中心" : "test",
        kind: "channel",
        description: "研发中心",
      },
      { roomId: "old", name: "old", kind: "channel", archivedAt: "2026-09-01" },
    ],
    setBody,
    textareaRef,
  });
  return (
    <main style={{ padding: 20 }}>
      <h1>真实提及组件 · 隔离数据</h1>
      <div style={{ position: "relative", marginTop: 200 }}>
        <ComposerMentionMenu
          agents={mention.candidates}
          id="fixture-mention"
          activeIndex={mention.activeIndex}
          onSelect={mention.select}
          open={mention.open}
        />
        <textarea
          ref={textareaRef}
          aria-label="提及输入"
          value={body}
          onChange={mention.onChange}
          onFocus={mention.onFocus}
          onBlur={mention.onBlur}
          onKeyDown={mention.onKeyDown}
        />
      </div>
    </main>
  );
}
function Fixture() {
  const [values, setValues] = useState(["a"]);
  if (new URLSearchParams(location.search).has("mention"))
    return <MentionFixture />;
  return (
    <main style={{ padding: 20, background: "white" }}>
      <style>{`section { display: grid; gap: 4px; margin: 16px 0; max-width: 360px; } section .rah-choice-row { text-align:left; padding:8px 12px; border:1px solid #ddd; font:14px/20px sans-serif; }`}</style>
      <h1>隔离颜色验收，无真实 Agent</h1>
      <Matrix />
      <Matrix nested />
      <DiscoveryFilter
        label="负责人"
        values={values}
        onChange={setValues}
        multiple={false}
        options={[
          { id: "a", label: "Agent A" },
          { id: "b", label: "Agent B" },
          { id: "c", label: "Disabled", disabledReason: "不可选" },
        ]}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
