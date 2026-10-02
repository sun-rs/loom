import { useState, useSyncExternalStore } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  LocalRuntimeInventoryEntry,
  RoleTemplate,
} from "@rah-os/protocol";
import { AgentCreateDialog } from "./agent-dialogs.tsx";
import { RoleWrite } from "../role-write.ts";

export function RoleRevisionEditor({
  role,
  write,
  client,
  runtimes,
  readHead,
  onSaved,
  onRefreshModels,
}: {
  role: RoleTemplate | undefined;
  write: RoleWrite;
  client: RahClient;
  runtimes: readonly LocalRuntimeInventoryEntry[];
  readHead: (roomId: string) => Promise<number>;
  onSaved: () => void;
  onRefreshModels: (offerId: string) => Promise<void>;
}) {
  const phase = useSyncExternalStore(write.subscribe, () => write.state);
  const [editing, setEditing] =
    useState<
      Pick<
        RoleTemplate,
        "roleId" | "roleRevisionId" | "controlRoomId" | "configuration"
      >
    >();
  const saved = write.payload as
    | {
        roleId: string;
        expectedRoleRevisionId: string;
        controlRoomId: string;
        configuration: RoleTemplate["configuration"];
      }
    | undefined;
  return (
    <>
      {phase !== "idle" ? (
        <button
          className="btn"
          disabled={phase === "pending"}
          onClick={() => {
            if (saved)
              setEditing({
                roleId: saved.roleId,
                roleRevisionId: saved.expectedRoleRevisionId,
                controlRoomId: saved.controlRoomId,
                configuration: saved.configuration,
              });
          }}
        >
          继续核实修订
        </button>
      ) : (
        role && (
          <button className="btn" onClick={() => setEditing(role)}>
            编辑配置
          </button>
        )
      )}
      {phase === "unknown" && (
        <button
          className="btn"
          onClick={() => {
            if (
              window.confirm(
                "放弃核实不会撤销可能已保存的修订。请重新读取 Role 后再编辑。",
              )
            ) {
              write.discard();
              setEditing(undefined);
              onSaved();
            }
          }}
        >
          放弃核实修订
        </button>
      )}
      {editing && (
        <AgentCreateDialog
          roleConfiguration
          initialConfiguration={editing.configuration}
          resultUnknown={phase === "unknown"}
          client={client}
          computerLabel="本机"
          runtimes={runtimes}
          onRefreshModels={onRefreshModels}
          onClose={() => setEditing(undefined)}
          onCreate={async (configuration) => {
            const result = await write.run(
              {
                roleId: editing.roleId,
                expectedRoleRevisionId: editing.roleRevisionId,
                controlRoomId: editing.controlRoomId,
                configuration,
              },
              () => readHead(editing.controlRoomId),
              ({ controlRoomId: _scope, ...request }) =>
                client.request("role.revise", request),
            );
            onSaved();
            return result.role.roleId;
          }}
        />
      )}
    </>
  );
}
