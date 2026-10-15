import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { AgentCatalogEntry } from "@rah-os/protocol";
import { useAppearanceStore } from "../packages/web/src/store/appearanceStore.ts";
import { LiveAgentActivityBarPresentation } from "../packages/web/src/components/layout/LiveAgentActivityBar.tsx";
import type { LiveAgentActivityItem } from "../packages/web/src/utils/liveAgentActivity.ts";
const AppearanceRuntime = createContext<{
  models: Record<string, string>;
  latest: LiveAgentActivityItem | null;
}>({ models: {}, latest: null });
export const useLoomModelLabel = (id: string) =>
  useContext(AppearanceRuntime).models[id];
/** Read-only view data. No upstream server stores, inferred presence, or mutation path. */
export function AppearanceRuntimeProvider({
  client,
  controlRoomId,
  roomId,
  children,
}: {
  client: RahClient;
  controlRoomId?: string;
  roomId?: string;
  children: ReactNode;
}) {
  const showModels = useAppearanceStore((s) => s.showAgentModelName);
  const showActivity = useAppearanceStore((s) => s.showLiveAgentActivityBar);
  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>([]);
  const [models, setModels] = useState<Record<string, string>>({});
  const [latest, setLatest] = useState<LiveAgentActivityItem | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setCatalog([]);
    setModels({});
    if (!controlRoomId || (!showModels && !showActivity)) return;
    const read = async () => {
      try {
        const [agents, inventory] = await Promise.all([
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
        ]);
        if (controller.signal.aborted) return;
        setCatalog(agents.agents);
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
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(read, 60000);
      }
    };
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, controlRoomId, showModels, showActivity]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setLatest(null);
    if (!showActivity || !roomId) return;
    const read = async () => {
      try {
        const state = await client.request(
          "room.agent.activity.list",
          { roomId },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        const entry = state.agents
          .filter((a) => a.roomId === roomId && a.state !== "idle")
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        const agent =
          entry &&
          catalog.find(
            (a) => a.definition.participantId === entry.participantId,
          );
        const name =
          agent?.currentRevision.displayName ?? agent?.handle ?? "实例";
        setLatest(
          entry
            ? {
                id:
                  entry.runAttemptId ??
                  entry.activationId ??
                  entry.participantId,
                kind: "activity",
                agentId: entry.participantId,
                agentName: name,
                agentAvatarUrl: null,
                text: `${name} · ${{ working: "运行中", waking: "排队或启动中", error: "错误", idle: "空闲" }[entry.state]}`,
                context: roomId,
                activity: entry.state === "error" ? "error" : "working",
                createdAt: Date.parse(entry.updatedAt),
              }
            : null,
        );
      } catch {
        if (!controller.signal.aborted) setLatest(null);
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
  }, [client, roomId, showActivity, catalog]);
  return (
    <AppearanceRuntime.Provider value={{ models, latest }}>
      {children}
    </AppearanceRuntime.Provider>
  );
}
export function LoomLiveActivity() {
  const { latest } = useContext(AppearanceRuntime);
  const visible = useAppearanceStore((s) => s.showLiveAgentActivityBar);
  return visible && latest ? (
    <div data-testid="loom-live-agent-activity">
      <LiveAgentActivityBarPresentation latest={latest} />
    </div>
  ) : null;
}
