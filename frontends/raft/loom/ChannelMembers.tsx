import { useLoomPresence } from "./AppearanceRuntime.tsx";
import { instanceActivity } from "./working-state.ts";
import { DirectMessageIcon } from "raft-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "raft-ui";
import {
  MembersStrip,
  MemberPage,
  MemberPicker,
  ChannelMemberRow,
  ChannelMemberHoverActions,
  type Member,
} from "./OfficialMemberFlow.generated.tsx";
import type { LoomChannelClient } from "./channel-client.ts";
import type { RoleListResponse, AgentCatalogEntry } from "@rah-os/protocol";
import { ManagementClient } from "./management-client.ts";
import { OperationStatus, useManagement } from "./ManagementUi.tsx";
import ConfirmDialog from "../packages/web/src/components/ConfirmDialog.tsx";
import CreateRoleDialog from "./CreateRoleDialog.tsx";
import { useRouteIntentOwner } from "./useIntentRoute.ts";
/** Native drawer-internal navigation. Kernel membership and immutable Role revisions own writes. */
export default function ChannelMembers({
  bridge,
  workspaceId,
  controlRoomId,
  container,
  onPageChange,
  onOpenPrivate,
  onOpenProfile,
  onAddInstance,
}: {
  bridge: LoomChannelClient;
  workspaceId: string;
  controlRoomId: string;
  container: HTMLElement | null;
  onPageChange: (value: boolean) => void;
  onOpenPrivate: (id: string) => void;
  onOpenProfile?: (id: string) => void;
  onAddInstance?: () => void;
}) {
  const manager = useMemo(
    () => new ManagementClient(bridge.client, workspaceId, controlRoomId),
    [bridge, controlRoomId],
  );
  useRouteIntentOwner(manager.writes);
  const { state, error, setError } = useManagement(manager);
  const [members, setMembers] =
    useState<Awaited<ReturnType<LoomChannelClient["members"]>>>();
  const [catalog, setCatalog] = useState<RoleListResponse>();
  const [agentEntries, setAgentEntries] = useState<AgentCatalogEntry[]>([]);
  const [view, setView] = useState<"root" | "members" | "add">("root");
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const [selected, setSelected] = useState(new Set<string>()),
    [tick, setTick] = useState(0),
    [create, setCreate] = useState(false),
    [remove, setRemove] = useState<Member>();
  const busy = state !== "idle";
  const presence = useLoomPresence();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    onPageChange(view !== "root");
    return () => onPageChange(false);
  }, [view, onPageChange]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const value = await bridge.members(abort.signal);
        if (!abort.signal.aborted) setMembers(value);
      } catch {
        if (!abort.signal.aborted) {
          setMembers(undefined);
          setError("成员状态暂时无法读取，正在重试。");
        }
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(read, 3000);
      }
    }
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [bridge, tick, setError]);
  useEffect(() => {
    const abort = new AbortController();
    setCatalog(undefined);
    void Promise.all([
      bridge.client.request(
        "role.list",
        { controlRoomId },
        { signal: abort.signal },
      ),
      bridge.client.request(
        "agent.list",
        { controlRoomId },
        { signal: abort.signal },
      ),
    ])
      .then(([value, agents]) => {
        if (!abort.signal.aborted) {
          setCatalog(value);
          setAgentEntries(agents.agents);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("无法读取角色，请返回后重试。");
      });
    return () => abort.abort();
  }, [bridge, controlRoomId, tick, setError]);
  const identified: (Member & { kind: string })[] = (members ?? []).map((m) => {
    const principal = bridge.view().members.find((p) => p.principalId === m.id);
    const instance = catalog?.instances.find((i) => i.instanceId === m.id);
    const avatar = agentEntries.find(
      (a) => a.definition.agentId === instance?.agentId,
    )?.currentRevision.avatarKey;
    const activity =
      m.kind === "agent"
        ? instanceActivity(m.id, agentEntries, presence)
        : undefined;
    return {
      ...m,
      presence:
        m.kind === "agent"
          ? activity === "working" || activity === "thinking"
            ? "busy"
            : (activity ?? "offline")
          : undefined,
      avatarUrl:
        m.kind === "human"
          ? principal?.avatarKey
            ? bridge.client.profileImages?.url(principal.avatarKey)
            : undefined
          : avatar,
    };
  });
  const humans = identified.filter((m) => m.kind === "human"),
    agents = identified.filter((m) => m.kind === "agent");
  const matches = (m: Member) =>
    m.name.toLowerCase().includes(query.trim().toLowerCase());
  const back = () => {
    if (!busy) {
      setView(view === "add" ? "members" : "root");
      setSelected(new Set());
      setError("");
    }
  };
  const add = async () => {
    if (busy || !catalog) return;
    setError("");
    // The backend has per-instance atomic writes, not an atomic multi-role batch.
    // Snapshot selected IDs; settle each existing intent; stop on rejection or unknown.
    for (const id of [...selected]) {
      let succeeded = false;
      const outcome = await manager.instance(
        "add",
        bridge.roomId,
        id,
        (result) => {
          if (result.kind === "ok") {
            succeeded = true;
            setSelected((previous) => {
              const next = new Set(previous);
              next.delete(id);
              return next;
            });
            setTick((v) => v + 1);
          } else if (result.kind === "rejected")
            setError("部分实例未添加，已成功的保留；请检查后重试剩余项。");
        },
      );
      if (!alive.current || !succeeded || outcome?.kind !== "ok") return;
    }
    setView("members");
  };
  const renderRow = (m: Member) => {
    const agent = agents.some((a) => a.id === m.id);
    const observed = agent
      ? instanceActivity(m.id, agentEntries, presence)
      : undefined;
    const detail = agent
      ? observed
        ? {
            working: "工作中",
            thinking: "思考中…",
            online: "在线",
            offline: "离线",
            error: "异常",
          }[observed]
        : "状态未知"
      : members?.find((a) => a.id === m.id)?.detail;
    return (
      <ChannelMemberRow
        key={m.id}
        type={agent ? "agent" : "human"}
        name={m.name}
        humanAvatarUrl={m.avatarUrl}
        agentAvatarUrl={m.avatarUrl}
        presence={m.presence}
        secondary={detail}
        onRowClick={
          agent && onOpenProfile ? () => onOpenProfile(m.id) : undefined
        }
        trailing={
          agent ? (
            <div className="flex items-center gap-2">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`频道内私密消息 ${m.name}`}
                disabled={busy}
                onClick={() => onOpenPrivate(m.id)}
              >
                <DirectMessageIcon width={16} height={16} />
              </Button>
              {!busy && onAddInstance && (
                <ChannelMemberHoverActions
                  removeAction={{
                    label: `移除 ${m.name}`,
                    onClick: () => setRemove(m),
                  }}
                />
              )}
            </div>
          ) : undefined
        }
      />
    );
  };
  const roles = (catalog?.roles ?? []).map((r) => ({
    id: r.roleId,
    name: r.configuration.displayName ?? r.configuration.handle,
    description: r.configuration.description,
    avatarUrl: r.configuration.avatarKey,
  }));
  const page = (
    <MemberPage
      showAddSection={view === "add"}
      membersLoading={!members}
      totalParticipants={members?.length ?? 0}
      handleBackOrReset={back}
      rosterQuery={query}
      handleRosterQueryChange={(e) => setQuery(e.target.value)}
      visibleHumans={humans.filter(matches)}
      visibleAgents={agents.filter(matches)}
      renderHumanRow={renderRow}
      renderAgentRow={renderRow}
      openAddSection={() => setView("add")}
      showAddEntry={!!onAddInstance}
      error={error}
    >
      <OperationStatus manager={manager} error={error} />
      <MemberPicker
        filteredAgents={roles.filter((r) =>
          r.name.toLowerCase().includes(search.trim().toLowerCase()),
        )}
        memberSearch={search}
        handleMemberSearchChange={(e) => setSearch(e.target.value)}
        selectedKeys={selected}
        toggleCandidate={(id) => {
          if (!busy)
            setSelected((previous) => {
              const next = new Set(previous);
              next.has(id) ? next.delete(id) : next.add(id);
              return next;
            });
        }}
        adding={busy || !catalog}
        handleConfirmAddClick={() =>
          void add().catch(() => setError("添加未完成，请检查状态后重试。"))
        }
        onCreate={() => setCreate(true)}
        hasAvailable={!!roles.length}
      />
    </MemberPage>
  );
  return (
    <>
      {/* Native strip owns px-4; cancel that inset inside the native DrawerBody. */}
      <div className="-mx-4" data-testid="channel-member-strip-inset">
        <MembersStrip
          channelHumans={humans}
          channelAgents={agents}
          loading={!members}
          onOpen={() => setView("members")}
          onAdd={onAddInstance ? () => setView("add") : undefined}
        />
      </div>
      {view !== "root" && container && createPortal(page, container)}
      {create && (
        <CreateRoleDialog
          client={bridge.client}
          workspaceId={workspaceId}
          controlRoomId={controlRoomId}
          onClose={() => setCreate(false)}
          onChanged={() => setTick((t) => t + 1)}
        />
      )}
      {remove && (
        <ConfirmDialog
          title="移除实例"
          message={
            <>
              <p>{`从频道移除 ${remove.name}，停止后续投递并结束其执行。保留历史；再次添加会创建新实例。`}</p>
              <OperationStatus manager={manager} error={error} />
            </>
          }
          confirmLabel="移除实例"
          confirmVariant="danger"
          confirmDisabled={busy}
          closeOnConfirm={false}
          onClose={() => {
            if (!busy) setRemove(undefined);
          }}
          onConfirm={async () => {
            await manager.instance(
              "remove",
              bridge.roomId,
              remove.id,
              (result) => {
                if (result.kind === "ok") {
                  setRemove(undefined);
                  setTick((t) => t + 1);
                } else if (result.kind === "rejected")
                  setError("移除被拒绝，请检查实例状态后重试。");
              },
            );
          }}
        />
      )}
    </>
  );
}
