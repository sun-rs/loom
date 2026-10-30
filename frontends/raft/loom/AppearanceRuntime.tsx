import {
  projectRoleAvatars,
  type InstanceAvatarMap,
} from "./role-avatar-projection.ts";
import { useSidebarPreferences } from "./useSidebarPreferences";
import {
  messageInstanceState,
  type MessageStatusFacts,
} from "./message-status.ts";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { AgentCatalogEntry, AgentPresence } from "@rah-os/protocol";
import { useAppearanceStore } from "../packages/web/src/store/appearanceStore.ts";
import {
  NativeWorkingSummary,
  NativeChannelWorking,
  type WorkingItem,
} from "./OfficialWorkingSurfaces140.generated.js";
import { useInstancePresence } from "./InstancePresence.tsx";
import { projectWorkingInstances } from "./working-state.ts";
const AppearanceRuntime = createContext<{
  facts?: MessageStatusFacts;
  expandedRooms?: readonly string[];
  models: Record<string, string>;
  presence: AgentPresence[];
  working: WorkingItem[];
  avatars: InstanceAvatarMap;
  refreshIdentity: () => void;
  onOpen: (id: string) => void;
}>({
  models: {},
  presence: [],
  working: [],
  avatars: {},
  refreshIdentity: () => {},
  onOpen: () => {},
});
export const useLoomModelLabel = (id: string) =>
  useContext(AppearanceRuntime).models[id];
export const useLoomMessageState = (roomId: string, id: string) =>
  messageInstanceState(useContext(AppearanceRuntime).facts, roomId, id);
export const useLoomCollapseLongMessages = (roomId: string) =>
  !useContext(AppearanceRuntime).expandedRooms?.includes(`room:${roomId}`);
/** Read-only view data. No upstream server stores, inferred presence, or mutation path. */
export function AppearanceRuntimeProvider({
  client,
  controlRoomId,
  workspaceId,
  roomId,
  children,
  onOpenInstance,
}: {
  client: RahClient;
  controlRoomId?: string;
  workspaceId?: string;
  roomId?: string;
  children: ReactNode;
  onOpenInstance?: (instance: {
    instanceId: string;
    channelId: string;
  }) => void;
}) {
  const { preferences } = useSidebarPreferences(client, workspaceId);
  const showModels = useAppearanceStore((s) => s.showAgentModelName);
  const [facts, setFacts] = useState<MessageStatusFacts>();
  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>([]);
  const [models, setModels] = useState<Record<string, string>>({});
  const [avatars, setAvatars] = useState<InstanceAvatarMap>({});
  const [identityRevision, setIdentityRevision] = useState(0);
  const refreshIdentity = useCallback(
    () => setIdentityRevision((r) => r + 1),
    [],
  );
  const presence = useInstancePresence(client, controlRoomId, true, 3000);
  const working = useMemo(
    () =>
      projectWorkingInstances(catalog, presence).map((item) => ({
        ...item,
        agentAvatarUrl: avatars[item.agentId] ?? item.agentAvatarUrl,
      })),
    [catalog, presence, avatars],
  );
  const unknown = presence
    .filter((p) => !catalog.some((a) => a.definition.agentId === p.agentId))
    .map((p) => p.agentId)
    .sort()
    .join("\0");
  useEffect(() => {
    setCatalog([]);
    setModels({});
    setAvatars({});
  }, [client, controlRoomId]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    if (!controlRoomId) return;
    const read = async () => {
      try {
        const [agents, inventory, roles] = await Promise.all([
          client.request(
            "agent.list",
            { controlRoomId },
            { signal: controller.signal },
          ),
          showModels
            ? client.request(
                "host.runtime.list",
                {},
                { signal: controller.signal },
              )
            : Promise.resolve(null),
          client.request(
            "role.list",
            { controlRoomId },
            { signal: controller.signal },
          ),
        ]);
        if (controller.signal.aborted) return;
        setCatalog(agents.agents);
        setAvatars(projectRoleAvatars(roles, agents.agents));
        const labels = new Map(
          inventory?.runtimes.flatMap((r) =>
            r.modelBindingDescriptors.map(
              (b) => [b.modelBindingId, b.displayName ?? b.modelId] as const,
            ),
          ) ?? [],
        );
        setModels(
          Object.fromEntries(
            agents.agents.flatMap((a) => {
              const label = a.modelBindingId
                ? labels.get(a.modelBindingId)
                : undefined;
              return label ? [[a.definition.participantId, label]] : [];
            }),
          ),
        );
      } catch {
        if (!controller.signal.aborted) {
          setCatalog([]);
          setModels({});
          setAvatars({});
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(read, 60000);
      }
    };
    const onFocus = () => refreshIdentity();
    window.addEventListener("focus", onFocus);
    void read();
    return () => {
      window.removeEventListener("focus", onFocus);
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    client,
    controlRoomId,
    showModels,
    unknown,
    identityRevision,
    refreshIdentity,
  ]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setFacts(undefined);
    if (!roomId) return;
    const read = async () => {
      try {
        const [state, membership] = await Promise.all([
          client.request(
            "room.agent.activity.list",
            { roomId },
            { signal: controller.signal },
          ),
          client.request(
            "room.member.list",
            { roomId },
            { signal: controller.signal },
          ),
        ]);
        if (controller.signal.aborted) return;
        setFacts({
          roomId,
          members: membership.memberships.map((m) => m.principalId),
          activities: state.agents,
        });
      } catch {
        if (!controller.signal.aborted) {
          setFacts(undefined);
        }
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(read, document.hidden ? 15000 : 3000);
      }
    };
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, roomId]);
  return (
    <AppearanceRuntime.Provider
      value={{
        models,
        avatars,
        refreshIdentity,
        expandedRooms: preferences?.expandedLongMessages,
        presence,
        working,
        onOpen: (id) => {
          const agent = catalog.find((a) => a.definition.participantId === id);
          if (agent?.instanceChannelId)
            onOpenInstance?.({
              instanceId: id,
              channelId: agent.instanceChannelId,
            });
        },
        facts: facts?.roomId === roomId ? facts : undefined,
      }}
    >
      {children}
    </AppearanceRuntime.Provider>
  );
}
export function useLoomPresence() {
  return useContext(AppearanceRuntime).presence;
}
export function LoomWorkingSummary({
  onFrame = false,
  variant = "count",
}: {
  onFrame?: boolean;
  variant?: "count" | "full";
}) {
  const { working, onOpen } = useContext(AppearanceRuntime);
  const enabled = useAppearanceStore((s) => s.showLiveAgentActivityBar);
  return (
    <NativeWorkingSummary
      items={working}
      enabled={enabled}
      onOpen={onOpen}
      onFrame={onFrame}
      variant={variant}
    />
  );
}
export function useLoomChannelSubtitle({
  memberIds,
  description,
}: {
  memberIds: string[];
  description?: string;
}) {
  const { working } = useContext(AppearanceRuntime);
  const enabled = useAppearanceStore((s) => s.showLiveAgentActivityBar);
  if (
    !description &&
    (!enabled || !working.some((item) => memberIds.includes(item.agentId)))
  )
    return undefined;
  return (
    <NativeChannelWorking
      items={working}
      enabled={enabled}
      memberIds={memberIds}
      description={description}
    />
  );
}

export const useLoomAvatarMap = () => useContext(AppearanceRuntime).avatars;
export const useLoomIdentityRefresh = () =>
  useContext(AppearanceRuntime).refreshIdentity;
export function useLoomDisplayMembers(
  members: readonly import("@rah-os/protocol").Principal[],
) {
  const avatars = useLoomAvatarMap();
  return useMemo(
    () =>
      members.map((m) =>
        m.kind === "agent" && Object.hasOwn(avatars, m.principalId)
          ? { ...m, avatarKey: avatars[m.principalId] }
          : m,
      ),
    [members, avatars],
  );
}
