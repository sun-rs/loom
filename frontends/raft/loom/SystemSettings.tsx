import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { RahClient } from "@rah-os/client-sdk";
import { SystemChannelsSection } from "./OfficialSettingsSections.generated.tsx";
import { ManagementClient } from "./management-client.ts";
import { OperationStatus, useManagement } from "./ManagementUi.tsx";
import { useRouteIntentOwner } from "./useIntentRoute.ts";

const Context = createContext<ReturnType<typeof useController> | null>(null);
export function useSystemSettings() {
  const value = useContext(Context);
  if (!value) throw Error("Missing system settings owner");
  return value;
}
function useController(
  client: RahClient,
  workspaceId: string,
  controlRoomId: string,
) {
  const manager = useMemo(
    () => new ManagementClient(client, workspaceId, controlRoomId),
    [client, workspaceId, controlRoomId],
  );
  useRouteIntentOwner(manager.writes);
  const { state, error, setError } = useManagement(manager);
  const [base, setBase] = useState<boolean>();
  const [allChannelHidden, setHidden] = useState(false);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const abort = new AbortController();
    void client
      .request(
        "workspace.system-channel.read",
        { workspaceId },
        { signal: abort.signal },
      )
      .then((result) => {
        if (abort.signal.aborted) return;
        setBase(result.hidden);
        setHidden(result.hidden);
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError("无法读取系统频道设置，请重新打开此页。");
      });
    return () => {
      abort.abort();
      clearTimeout(timer.current);
    };
  }, [client, workspaceId, setError]);
  return {
    manager,
    allChannelHidden,
    saved,
    error,
    ready: base !== undefined,
    saving: state !== "idle",
    dirty: base !== undefined && base !== allChannelHidden,
    handleAllChannelHiddenChange(checked: boolean) {
      if (manager.writes.state !== "idle") return;
      setHidden(checked);
      setSaved(false);
      clearTimeout(timer.current);
    },
    async handleSave(event: FormEvent) {
      event.preventDefault();
      if (
        base === undefined ||
        base === allChannelHidden ||
        manager.writes.state !== "idle"
      )
        return;
      setError("");
      setSaved(false);
      try {
        await manager.writes.submit({
          action: "system-channel-visibility",
          session: manager.control,
          payload: { workspaceId, hidden: allChannelHidden },
          send: (payload, basedOnRoomSeq, idempotencyKey) =>
            client.request("workspace.system-channel.update", {
              ...payload,
              basedOnRoomSeq,
              idempotencyKey,
            }),
          onSettled: (outcome) => {
            if (outcome.kind === "ok") {
              setBase(outcome.result.hidden);
              setHidden(outcome.result.hidden);
              setSaved(true);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setSaved(false), 2000);
            } else if (outcome.kind === "rejected")
              setError(
                "未保存系统频道设置；请检查权限及 #all 中是否仍有活动工作。",
              );
          },
        });
      } catch {
        setError("无法保存系统频道设置，请稍后重试。");
      }
    },
  };
}
export default function SystemSettings({
  client,
  workspaceId,
  controlRoomId,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
}) {
  const value = useController(client, workspaceId, controlRoomId);
  return (
    <Context.Provider value={value}>
      <SystemChannelsSection />
      <OperationStatus
        manager={value.manager}
        error={value.ready ? "" : value.error}
      />
    </Context.Provider>
  );
}
