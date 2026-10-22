import { useMemo, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { SidebarPreferences } from "@rah-os/protocol";
import { Button } from "raft-ui";
import { LoomWorkspaceMute } from "./OfficialSettingsSections.generated";
import { ManagementClient } from "./management-client";
import { OperationStatus, useManagement } from "./ManagementUi";
import { useSidebarPreferences } from "./useSidebarPreferences";
import { useDraftNavigation } from "./DraftNavigation";
export default function WorkspaceMute({
  client,
  workspaceId,
  controlRoomId,
  busy,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
  busy: boolean;
}) {
  const read = useSidebarPreferences(client, workspaceId);
  const manager = useMemo(
    () => new ManagementClient(client, workspaceId, controlRoomId),
    [client, workspaceId, controlRoomId],
  );
  const operation = useManagement(manager);
  const [draft, setDraft] = useState<{
      value: boolean;
      preferences: SidebarPreferences;
    }>(),
    [rejected, setRejected] = useState(false);
  const preferences = draft?.preferences ?? read.preferences;
  const dirty = !!draft && draft.value !== draft.preferences.mutedWorkspace;
  useDraftNavigation(dirty, () => setDraft(undefined));
  return (
    <>
      <LoomWorkspaceMute
        currentServer={{ name: "当前工作区" }}
        loading={!preferences || read.error || rejected}
        busy={busy}
        testing={false}
        muting={operation.state !== "idle"}
        serverPushMuted={draft?.value ?? preferences?.mutedWorkspace ?? false}
        savedServerPushMuted={preferences?.mutedWorkspace ?? false}
        handleServerPushMutedChange={(value) => {
          if (preferences) setDraft({ value, preferences });
        }}
        handleSaveServerMute={(event) => {
          event.preventDefault();
          if (
            !preferences ||
            !draft ||
            !dirty ||
            read.error ||
            rejected ||
            busy ||
            operation.state !== "idle"
          )
            return;
          operation.setError("");
          void manager.sidebar(
            { mutedWorkspace: draft.value },
            preferences.version,
            (outcome) => {
              if (outcome.kind === "ok") {
                setDraft(undefined);
                window.dispatchEvent(
                  new Event("loom:sidebar-preferences-changed"),
                );
              } else if (outcome.kind === "rejected") {
                setRejected(true);
                operation.setError(
                  "通知偏好可能已变化，未保存。请重新读取后再修改。",
                );
              }
            },
          );
        }}
      />
      <OperationStatus manager={manager} error={operation.error} />
      {(read.error || rejected) && (
        <div role="alert">
          无法核实当前偏好。
          <Button
            variant="ghost"
            size="sm"
            disabled={operation.state !== "idle"}
            onClick={() => {
              setDraft(undefined);
              setRejected(false);
              operation.setError("");
              read.reload();
            }}
          >
            放弃草稿并重新读取
          </Button>
        </div>
      )}
    </>
  );
}
