import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomTransform } from "d3-zoom";

import type { RahClient } from "@rah-os/client-sdk";
import type {
  ClientWorkspaceMemberGraphResponse,
  MemberGraphAgent,
  MemberGraphChannel,
  MemberGraphEdge,
  MemberGraphHuman,
} from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

import { PanelHeader } from "@rah-os/ui-web/neo-brutalist/panel-header";
import { PreviewCard } from "./preview-card.tsx";
import {
  useHumanIdentity,
  useWorkspaceEntities,
} from "./workspace-entity-context.tsx";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
import { AgentAvatar } from "./agent-avatar.tsx";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import {
  computeMemberGraphLayout,
  MEMBER_GRAPH_HEIGHT as GRAPH_HEIGHT,
  MEMBER_GRAPH_WIDTH as GRAPH_WIDTH,
  type MemberGraphPoint as Point,
} from "../member-relationship-graph-layout.ts";

type Member = MemberGraphHuman | MemberGraphAgent;
const MAX_SCALE = 4;

export function MemberRelationshipSurface({
  agents,
  client,
  onBack,
  onOpenAgent,
  workspaceId,
}: {
  agents: readonly WorkspaceAgentView[];
  client: RahClient;
  onBack: () => void;
  onOpenAgent: (id: string) => void;
  workspaceId: string | undefined;
}) {
  const humanIdentity = useHumanIdentity();
  const entities = useWorkspaceEntities();
  const actorId = entities?.scope?.actorId;
  const [result, setResult] = useState<{
    actorId: string | undefined;
    workspaceId: string;
    value: ClientWorkspaceMemberGraphResponse;
  }>();
  const raw =
    result?.actorId === actorId && result?.workspaceId === workspaceId
      ? result?.value
      : undefined;
  const data = useMemo(
    () =>
      raw && {
        ...raw,
        humans: raw.humans.map((human) => {
          const person = entities?.person(human.principalId);
          return person?.kind === "human"
            ? {
                ...human,
                displayName: person.displayName ?? person.handle,
                handle: person.handle,
              }
            : human;
        }),
      },
    [raw, entities],
  );
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (workspaceId === undefined) {
      setResult(undefined);
      setError(undefined);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void client
      .request(
        "workspace.member-graph.get",
        { workspaceId },
        { signal: controller.signal },
      )
      .then((response) => {
        if (!controller.signal.aborted)
          setResult({ actorId, workspaceId, value: response });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [client, reload, workspaceId, actorId]);
  const members = useMemo(
    () => (data ? [...data.humans, ...data.agents] : []),
    [data],
  );
  const degrees = useMemo(() => graphDegrees(data?.edges ?? []), [data]);
  const mostConnected = useMemo(
    () =>
      [...members]
        .sort(
          (left, right) =>
            (degrees.get(memberKey(right)) ?? 0) -
              (degrees.get(memberKey(left)) ?? 0) ||
            memberDisplayName(left).localeCompare(memberDisplayName(right)),
        )
        .slice(0, 6),
    [degrees, members],
  );
  const largestChannels = useMemo(
    () =>
      [...(data?.channels ?? [])]
        .sort(
          (left, right) =>
            right.memberCount - left.memberCount ||
            left.name.localeCompare(right.name),
        )
        .slice(0, 6),
    [data],
  );
  return (
    <section className="rah-member-graph-surface rah-scroll-main">
      <PanelHeader kind="surface" className="rah-member-graph-page-header">
        <button
          aria-label="返回成员列表"
          className="rah-member-graph-mobile-back rah-interaction-flat"
          onClick={onBack}
          type="button"
        >
          <Icon name="chevron" />
        </button>
        <span className="rah-panel-header-icon">
          <Icon name="git-branch" />
        </span>
        <h2>关系图</h2>
        <span className="rah-member-graph-experimental">EXPERIMENTAL</span>
      </PanelHeader>
      <div className="rah-member-graph-body">
        <header className="rah-member-graph-header">
          <div>
            <Icon name="git-branch" />
            <h3>关系</h3>
            <span>{data ? members.length : null}</span>
          </div>
          <button
            className="btn"
            disabled={loading || workspaceId === undefined}
            onClick={() => setReload((value) => value + 1)}
            type="button"
          >
            <Icon name="refresh-cw" />
            {loading ? "刷新中…" : "刷新"}
          </button>
        </header>
        {error ? (
          <p className="rah-member-graph-warning" role="status">
            {error}
            {data ? "；已保留本工作区上一次成功结果。" : ""}
          </p>
        ) : null}
        {data?.truncated ? (
          <p className="rah-member-graph-warning" role="status">
            Workspace 成员或频道超过安全上限，当前图为有界结果。
          </p>
        ) : null}
        <div className="rah-member-graph-grid">
          <MemberGraphCanvas
            data={data}
            agents={agents}
            loading={loading}
            onOpenAgent={onOpenAgent}
          />
          <aside className="rah-member-graph-summary" aria-label="关系图摘要">
            <div className="rah-member-graph-counts">
              <GraphMetric label="人类" value={data?.humans.length ?? 0} />
              <GraphMetric label="Agent" value={data?.agents.length ?? 0} />
              <GraphMetric label="连接" value={data?.edges.length ?? 0} />
            </div>
            <GraphSummaryCard title="连接最多的成员">
              {mostConnected.length === 0 ? (
                <i>暂无成员关系</i>
              ) : (
                mostConnected.map((member) => (
                  <button
                    type="button"
                    onClick={() =>
                      member.type === "human"
                        ? humanIdentity?.onOpenHuman(member.principalId)
                        : onOpenAgent(member.agentId)
                    }
                    className="rah-member-graph-summary-row"
                    key={memberKey(member)}
                  >
                    <MemberCompactAvatar member={member} agents={agents} />
                    <b>{memberDisplayName(member)}</b>
                    <span>{degrees.get(memberKey(member)) ?? 0}</span>
                  </button>
                ))
              )}
            </GraphSummaryCard>
            <GraphSummaryCard title="最大的频道">
              {largestChannels.length === 0 ? (
                <i>暂无可见频道</i>
              ) : (
                largestChannels.map((channel) => (
                  <div
                    className="rah-member-graph-summary-row"
                    key={channel.id}
                  >
                    <Icon name="hash" />
                    <b>{channel.name}</b>
                    <span>
                      {channel.humanCount}H/{channel.agentCount}A
                    </span>
                  </div>
                ))
              )}
            </GraphSummaryCard>
          </aside>
        </div>
      </div>
    </section>
  );
}

function MemberGraphCanvas({
  agents,
  data,
  loading,
  onOpenAgent,
}: {
  agents: readonly WorkspaceAgentView[];
  data: ClientWorkspaceMemberGraphResponse | undefined;
  loading: boolean;
  onOpenAgent: (id: string) => void;
}) {
  const humanIdentity = useHumanIdentity();
  const container = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [size, setSize] = useState({ height: 0, width: 0 });
  const members = useMemo(
    () =>
      data
        ? [...data.humans, ...data.agents].sort((left, right) =>
            memberDisplayName(left).localeCompare(memberDisplayName(right)),
          )
        : [],
    [data],
  );
  const channels = useMemo(
    () =>
      [...(data?.channels ?? [])].sort(
        (left, right) =>
          right.memberCount - left.memberCount ||
          left.name.localeCompare(right.name),
      ),
    [data],
  );
  const edges = data?.edges ?? [];
  const dense = members.length > 34 || edges.length > 120;
  const layout = useMemo(
    () => computeMemberGraphLayout(members, edges, dense),
    [dense, edges, members],
  );
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      setSize({ height: bounds.height, width: bounds.width });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [channels.length, members.length]);
  useEffect(() => {
    const element = container.current;
    if (!element || size.width <= 0 || size.height <= 0) return;
    const behavior = zoom<HTMLDivElement, unknown>()
      .scaleExtent([1, MAX_SCALE])
      .extent([
        [0, 0],
        [size.width, size.height],
      ])
      .translateExtent([
        [0, 0],
        [size.width, size.height],
      ])
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        setTransform(event.transform);
      });
    const selection = select(element);
    selection.call(behavior);
    selection.call(behavior.transform, transformRef.current);
    return () => {
      selection.on(".zoom", null);
    };
  }, [size.height, size.width]);
  if (!data && loading) {
    return <div className="rah-member-graph-empty">正在加载关系图…</div>;
  }
  if (members.length === 0 && channels.length === 0) {
    return <div className="rah-member-graph-empty">暂无可见成员关系</div>;
  }
  const viewBox = graphViewBox(transform, size);
  const screenPosition = (point: Point): CSSProperties => ({
    left: transform.x + (point.x / GRAPH_WIDTH) * size.width * transform.k,
    top: transform.y + (point.y / GRAPH_HEIGHT) * size.height * transform.k,
  });
  return (
    <div
      aria-label="Workspace 成员关系图；可拖动、滚轮或双击缩放"
      className="rah-member-graph-canvas"
      ref={container}
    >
      <svg
        aria-label="Workspace 成员关系"
        role="img"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      >
        <rect
          fill="#f8f8f0"
          height={GRAPH_HEIGHT}
          width={GRAPH_WIDTH}
          x="0"
          y="0"
        />
        <g opacity={dense ? 0.16 : 0.34}>
          {edges.map((edge) => {
            const source = layout.positions.get(edge.source);
            const target = layout.positions.get(edge.target);
            if (!source || !target) return null;
            return (
              <path
                d={edgePath(source, target, dense)}
                fill="none"
                key={`${edge.source}:${edge.target}`}
                stroke="#111"
                strokeWidth={
                  dense
                    ? Math.min(1.8, 0.55 + edge.weight * 0.2)
                    : Math.min(3, 1.1 + edge.weight * 0.35)
                }
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </g>
      </svg>
      <div className="rah-member-graph-node-layer">
        {members.map((member) => {
          const key = memberKey(member);
          const point = layout.positions.get(key);
          if (!point) return null;
          return (
            <div
              className="rah-member-graph-node"
              key={key}
              style={screenPosition(point)}
            >
              <PreviewCard
                className="rah-member-graph-preview"
                label={memberDisplayName(member)}
                onClick={
                  member.type === "human"
                    ? () => humanIdentity?.onOpenHuman(member.principalId)
                    : () => onOpenAgent(member.agentId)
                }
                triggerClassName={`rah-member-graph-node-trigger is-${member.type}`}
                content={
                  <MemberGraphPreview
                    channels={channels}
                    member={member}
                    links={layout.degrees.get(key) ?? 0}
                  />
                }
              >
                <MemberNodeAvatar member={member} agents={agents} />
                <span
                  className={dense ? `is-dense is-${member.type}` : undefined}
                >
                  <b>
                    {truncateLabel(memberDisplayName(member), dense ? 12 : 16)}
                  </b>
                  {dense ? null : (
                    <small>{layout.degrees.get(key) ?? 0} 个连接</small>
                  )}
                </span>
              </PreviewCard>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MemberNodeAvatar({
  agents,
  member,
}: {
  agents: readonly WorkspaceAgentView[];
  member: Member;
}) {
  const entities = useWorkspaceEntities();
  if (member.type === "agent") {
    const agent = agents.find(({ agentId }) => agentId === member.agentId);
    return agent ? (
      <AgentAvatar agent={agent} showStatus={false} size="sidebar" />
    ) : (
      <AgentAvatar
        agent={{
          ...(member.avatarKey === undefined
            ? {}
            : { avatarKey: member.avatarKey }),
          connectionStatus: "offline",
          displayName: member.displayName,
          participantId: member.participantId,
          presence: {
            activity: "offline",
            agentId: member.agentId,
            reason: "host_offline",
          },
          runtimeAvailable: false,
          state: "disabled",
        }}
        showStatus={false}
        size="sidebar"
      />
    );
  }
  const person =
    entities?.resolvePerson({ ...member, kind: "human" }) ?? member;
  return (
    <ProfileImageAvatar
      avatarKey={person.avatarKey}
      name={person.displayName || person.handle}
      principalId={person.principalId}
      size="sidebar"
    />
  );
}

function MemberCompactAvatar({
  agents,
  member,
}: {
  agents: readonly WorkspaceAgentView[];
  member: Member;
}) {
  return <MemberNodeAvatar agents={agents} member={member} />;
}

function MemberGraphPreview({
  channels,
  links,
  member,
}: {
  channels: readonly MemberGraphChannel[];
  links: number;
  member: Member;
}) {
  const names = channels
    .filter((channel) => member.channelIds.includes(channel.id))
    .map((channel) => `#${channel.name}`);
  return (
    <div className="rah-member-graph-preview-body">
      <b>{memberDisplayName(member)}</b>
      <small>@{memberDisplayName(member)}</small>
      <dl>
        <dt>身份</dt>
        <dd>{member.type === "agent" ? "Agent" : "人类"}</dd>
        <dt>连接</dt>
        <dd>{links}</dd>
      </dl>
      <p>{names.length > 0 ? names.join(" · ") : "暂无共享频道"}</p>
    </div>
  );
}

function GraphMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function GraphSummaryCard({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="rah-member-graph-card">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function graphDegrees(edges: readonly MemberGraphEdge[]): Map<string, number> {
  const neighbors = new Map<string, Set<string>>();
  for (const edge of edges) {
    const source = neighbors.get(edge.source) ?? new Set<string>();
    source.add(edge.target);
    neighbors.set(edge.source, source);
    const target = neighbors.get(edge.target) ?? new Set<string>();
    target.add(edge.source);
    neighbors.set(edge.target, target);
  }
  return new Map([...neighbors].map(([key, values]) => [key, values.size]));
}

function graphViewBox(
  transform: ZoomTransform,
  size: { height: number; width: number },
) {
  if (size.width <= 0 || size.height <= 0) {
    return { height: GRAPH_HEIGHT, width: GRAPH_WIDTH, x: 0, y: 0 };
  }
  const width = GRAPH_WIDTH / transform.k;
  const height = GRAPH_HEIGHT / transform.k;
  return {
    height,
    width,
    x: clamp(
      (-transform.x / transform.k / size.width) * GRAPH_WIDTH,
      0,
      GRAPH_WIDTH - width,
    ),
    y: clamp(
      (-transform.y / transform.k / size.height) * GRAPH_HEIGHT,
      0,
      GRAPH_HEIGHT - height,
    ),
  };
}

function edgePath(source: Point, target: Point, dense: boolean): string {
  if (!dense) return `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
  const offset = Math.abs(target.x - source.x) * 0.48;
  const first = source.x < target.x ? source.x + offset : source.x - offset;
  const second = source.x < target.x ? target.x - offset : target.x + offset;
  return `M ${source.x} ${source.y} C ${first} ${source.y}, ${second} ${target.y}, ${target.x} ${target.y}`;
}

function memberKey(member: Member): string {
  return `${member.type}:${member.id}`;
}

function memberDisplayName(member: Member): string {
  return member.displayName || member.handle;
}

function truncateLabel(value: string, limit = 18): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
