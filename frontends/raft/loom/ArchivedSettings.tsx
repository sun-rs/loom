import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import NativeArchivedChannels from "./OfficialArchivedChannels.generated.tsx";
import { ManagementClient } from "./management-client.ts";
import { OperationStatus, useManagement } from "./ManagementUi.tsx";
import { useIntentRoute, useRouteIntentOwner } from "./useIntentRoute.ts";
import { hasUnresolvedIntents } from "@rah-os/client-core/write-intent";

type Channel = {
  id: string;
  name: string;
  type: "channel";
  archivedAt: string;
};
const Context = createContext<ReturnType<typeof useController> | null>(null);
export function useArchivedSettings() {
  const value = useContext(Context);
  if (!value) throw Error("Missing archived settings owner");
  return value;
}
function useController(
  client: RahClient,
  workspaceId: string,
  controlRoomId: string,
  active: boolean,
) {
  const manager = useMemo(
    () => new ManagementClient(client, workspaceId, controlRoomId),
    [client, workspaceId, controlRoomId],
  );
  useRouteIntentOwner(manager.writes);
  const { state, error, setError } = useManagement(manager);
  const [, setParams] = useIntentRoute();
  const [archivedChannels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true),
    [reload, setReload] = useState(0);
  const [readError, setReadError] = useState("");
  const [busyChannelId, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!active || state !== "idle") return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const result = await client.request(
          "room.list",
          { workspaceId },
          { signal: abort.signal },
        );
        if (abort.signal.aborted) return;
        setChannels(
          result.rooms
            .filter((r) => r.kind === "channel" && r.archivedAt)
            .map((r) => ({
              id: r.roomId,
              name: r.name,
              type: "channel" as const,
              archivedAt: r.archivedAt!,
            }))
            .sort(
              (a, b) =>
                b.archivedAt.localeCompare(a.archivedAt) ||
                a.name.localeCompare(b.name),
            ),
        );
        setReadError("");
      } catch {
        if (!abort.signal.aborted)
          setReadError("无法读取已归档频道，请稍后重试。");
      } finally {
        if (!abort.signal.aborted) {
          setLoading(false);
          timer = setTimeout(read, 15000);
        }
      }
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, workspaceId, active, state, reload, setError]);
  return {
    manager,
    capabilities: { archiveChannels: true },
    loading,
    archivedChannels,
    busyChannelId,
    error: error || readError,
    nav: {
      toChannel(id: string) {
        if (hasUnresolvedIntents()) return;
        setParams(new URLSearchParams({ room: id }));
      },
    },
    async handleUnarchive(channel: Channel) {
      if (manager.writes.state !== "idle") return;
      setError("");
      setBusy(channel.id);
      try {
        await manager.archive(channel.id, false, (outcome) => {
          if (outcome.kind === "unknown") return;
          setBusy(null);
          if (outcome.kind === "ok") setReload((n) => n + 1);
          else setError("无法取消归档；请检查权限及频道的最新状态。");
        });
      } catch {
        setBusy(null);
        setError("无法取消归档，请稍后重试。");
      }
    },
  };
}
export default function ArchivedSettings(props: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
  active: boolean;
}) {
  const value = useController(
    props.client,
    props.workspaceId,
    props.controlRoomId,
    props.active,
  );
  return (
    <Context.Provider value={value}>
      <NativeArchivedChannels />
      <OperationStatus
        manager={value.manager}
        error={value.archivedChannels.length ? "" : value.error}
      />
    </Context.Provider>
  );
}
