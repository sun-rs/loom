import InstanceProfile from "./InstanceProfile.tsx";
import { User } from "lucide-react";
import BlockedWorkControl from "./BlockedWorkControl.tsx";
import { useEffect, useRef, useState } from "react";
import type { Principal, Room } from "@rah-os/protocol";
import type { RahClient } from "@rah-os/client-sdk";
import { Activity, ChevronRight, X } from "lucide-react";
import {
  ProfilePanel,
  PanelAction,
  ConversationPanelTabs,
  ProfilePanelBody,
  Tabs,
  TabsList,
  TabsTab,
  TabsLabel,
  Button,
  Spinner,
} from "raft-ui";
import PanelHeader, {
  PROFILE_HEADER_SURFACE_CLASS,
  PROFILE_HANDLE_SIZE_CLASS,
} from "../packages/web/src/components/ui/PanelHeader.tsx";
import PanelResizeHandle from "../packages/web/src/components/ui/PanelResizeHandle.tsx";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import SectionEyebrow from "../packages/web/src/components/ui/SectionEyebrow.tsx";
import { useResizablePanel } from "../packages/web/src/hooks/useResizablePanel.ts";
import { useTimeFormatter } from "../packages/web/src/hooks/useTimeFormatter.ts";
import RuntimeControl from "./RuntimeControl.tsx";
import RunUsageDialog from "./RunUsageDialog.tsx";
import InstanceTrajectory from "./InstanceTrajectory.tsx";
import { loadInstanceActivity } from "./instance-activity.ts";

/** Native ProfilePanel + AgentDetailPanel header/activity composition, with
 * Loom reads instead of upstream stores. Kernel runtime controls and bounded diagnostic reads; no inferred presence.
 */
export default function InstanceInspector({
  client,
  controlRoomId,
  room,
  member,
  onClose,
  backLabel = "返回聊天",
  controlItems,
}: {
  client: RahClient;
  controlRoomId: string;
  room: Room;
  member: Principal;
  onClose: () => void;
  backLabel?: string;
  controlItems?: { label: string; run: () => void; icon?: React.ReactNode }[];
}) {
  const [tab, setTab] = useState("activity");
  const panel = useResizablePanel({
    storageKey: "loom:profilePanelWidth",
    min: 300,
    max: 600,
    defaultWidth: 380,
    direction: "left",
  });
  const [desktop, setDesktop] = useState(
    () => matchMedia("(min-width: 1024px)").matches,
  );
  const [identity, setIdentity] = useState<{
    agentId: string;
    instanceId: string;
    channelId: string;
  }>();
  const [tick, setTick] = useState(0);
  const [usage, setUsage] = useState<string>();
  const [cursor, setCursor] = useState<string>();
  const [result, setResult] =
    useState<Awaited<ReturnType<typeof loadInstanceActivity>>>();
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!result?.blocked) bottom.current?.scrollIntoView();
  }, [result?.records.length, cursor]);

  const { formatClockWithSeconds } = useTimeFormatter();
  useEffect(() => {
    const mq = matchMedia("(min-width: 1024px)");
    const change = () => setDesktop(mq.matches);
    mq.addEventListener("change", change);
    return () => mq.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !document.querySelector('[role="dialog"]') &&
        !document.querySelector('[role="menu"]')
      ) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setResult(undefined);
    setError("");
    const read = async () => {
      try {
        const value = await loadInstanceActivity(
          client,
          {
            controlRoomId,
            room,
            member,
            ...(cursor ? { beforeActivityId: cursor } : {}),
          },
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setResult(value);
          setIdentity(value.instance);
          setError("");
        }
      } catch {
        if (!abort.signal.aborted) {
          setResult(undefined);
          setError("实例动态暂时无法读取，正在重试。");
        }
      } finally {
        if (!abort.signal.aborted)
          timer = setTimeout(read, document.hidden ? 15000 : 3000);
      }
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, controlRoomId, room.roomId, member.principalId, cursor, tick]);
  return (
    <ProfilePanel
      data-testid="profile-panel"
      edge="attached"
      className="absolute inset-0 z-30 flex flex-col border-l-0 lg:relative lg:inset-auto lg:z-auto"
      style={desktop ? { width: panel.width, flex: "0 0 auto" } : undefined}
    >
      {desktop && (
        <PanelResizeHandle
          side="left"
          visibleFrom="md"
          data-testid="loom-inspector-resize"
          onPointerDown={panel.handleResizeStart}
          onPointerMove={panel.handleResizeMove}
          onPointerUp={panel.handleResizeEnd}
          onPointerCancel={panel.handleResizeEnd}
        />
      )}
      <ProfilePanelBody className="flex min-h-0 flex-1 flex-col bg-layer-panel font-sans ">
        <PanelHeader
          title={member.displayName ?? member.handle}
          subtitle={`@${member.handle}`}
          subtitleClassName={PROFILE_HANDLE_SIZE_CLASS}
          iconSlot={<AvatarSlot context="panel-header" type="agent" />}
          iconAlwaysVisible
          iconKind="avatar"
          onMobileBack={onClose}
          mobileBackProps={{ "aria-label": backLabel }}
          containerProps={{
            className: `agent-profile-header-container ${PROFILE_HEADER_SURFACE_CLASS}`,
          }}
          actions={
            <>
              {identity && (
                <RuntimeControl
                  disabled={!result}
                  client={client}
                  workspaceId={room.workspaceId}
                  controlRoomId={controlRoomId}
                  agentId={identity.agentId}
                  branchSource={identity}
                  items={controlItems}
                  name={member.displayName ?? member.handle}
                />
              )}
              <PanelAction
                data-loom-control="detail-close"
                onClick={onClose}
                className="hidden md:flex"
                aria-label="关闭实例详情"
                title="关闭实例详情"
              >
                <X />
              </PanelAction>
            </>
          }
        />
        <div className="min-w-0 max-w-full shrink-0">
          <ConversationPanelTabs
            render={<Tabs value={tab} onValueChange={setTab} />}
          >
            <TabsList aria-label="实例详情">
              <TabsTab value="profile">
                <User />
                <TabsLabel>资料</TabsLabel>
              </TabsTab>
              <TabsTab value="activity">
                <Activity />
                <TabsLabel>动态</TabsLabel>
              </TabsTab>
            </TabsList>
          </ConversationPanelTabs>
        </div>
        {tab === "profile" && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {result ? (
              <InstanceProfile
                client={client}
                instance={result.instance}
                room={room}
                stateLabel={result.stateLabel}
              />
            ) : (
              <p role={error ? "alert" : undefined} className="px-5 py-5">
                {error || "正在读取实例资料…"}
              </p>
            )}
          </div>
        )}
        <div
          className={
            tab === "activity"
              ? "flex min-h-0 flex-1 flex-col bg-layer-panel"
              : "hidden"
          }
        >
          <div className="flex items-center justify-between border-b  border-line-muted  bg-layer-panel  px-5 py-2">
            <SectionEyebrow as="div">本对话运行记录</SectionEyebrow>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            <BlockedWorkControl
              client={client}
              workspaceId={room.workspaceId}
              controlRoomId={controlRoomId}
              instance={result?.instance}
              blocked={result?.blocked}
              onChanged={() => setTick((v) => v + 1)}
            />
            {error ? (
              <p role="alert" className="px-3 text-sm">
                {error}
              </p>
            ) : !result ? (
              <Spinner aria-label="读取实例动态" />
            ) : (
              <div data-testid="loom-instance-activity">
                <p className="px-3 py-1 text-sm text-foreground-muted">
                  {result.stateLabel}
                  <span className="block text-xs mt-1">
                    当前会话累计压缩：
                    {result.instance.sessionCompactionCount ?? "未知"}
                  </span>
                </p>
                {result.records.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-foreground-muted">
                    {result.nextCursor
                      ? "本页没有此对话的运行记录，可查看更早记录。"
                      : "没有此对话的运行记录。"}
                  </p>
                ) : (
                  result.records.map((record) => (
                    <button
                      type="button"
                      onClick={() => setUsage(record.aggregateId)}
                      title="查看本次运行用量"
                      aria-label={`${record.eventType} · 查看用量`}
                      key={record.activityId}
                      data-testid="loom-run-record"
                      className="flex w-full text-left items-start gap-2 py-1.5 px-3 hover:bg-fill-muted  transition-colors"
                    >
                      <span className="shrink-0 font-mono text-xs text-foreground-placeholder  mt-0.5 whitespace-nowrap">
                        {formatClockWithSeconds(record.createdAt)}
                      </span>
                      <span className="min-w-0 flex-1 text-sm text-foreground-strong ">
                        {{
                          "run.started": "运行开始",
                          "run.finished": "运行结束",
                          "run.failed": "运行失败",
                          "run.cancelled": "运行取消",
                        }[record.eventType] ?? record.eventType}
                      </span>
                      <ChevronRight
                        size={12}
                        className="mt-1 shrink-0 text-foreground-muted"
                      />
                    </button>
                  ))
                )}
                <div className="flex gap-2 px-3 py-2">
                  {cursor && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCursor(undefined)}
                    >
                      最新记录
                    </Button>
                  )}
                  {result.nextCursor && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setResult(undefined);
                        setCursor(result.nextCursor);
                      }}
                    >
                      更早记录
                    </Button>
                  )}
                </div>
                <InstanceTrajectory
                  client={client}
                  agentId={result.instance.agentId}
                  instanceId={member.principalId}
                  roomId={room.roomId}
                />
                <div ref={bottom} />
              </div>
            )}
          </div>
        </div>
      </ProfilePanelBody>
      {usage && result && (
        <RunUsageDialog
          client={client}
          agentId={result.instance.agentId}
          runAttemptId={usage}
          onClose={() => setUsage(undefined)}
        />
      )}
    </ProfilePanel>
  );
}
