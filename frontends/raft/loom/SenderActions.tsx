// Loom-only commands appended to the locked official sender menu. Presentation
// state lives here; private/branch lifecycle remains in the existing owners.
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { Principal, Room, RoleListResponse } from "@rah-os/protocol";
import { GitFork, MessageSquare, MessagesSquare } from "lucide-react";
import MenuItem from "../packages/web/src/components/ui/MenuItem";
import ConfirmDialog from "../packages/web/src/components/ConfirmDialog";
import { hasUnresolvedIntents } from "@rah-os/client-core/write-intent";
import { useInstanceBranches } from "./useInstanceBranches";
type Action = "private" | "fork" | "side";
const SenderActions = createContext<{
  allows: (id: string) => boolean;
  run: (id: string, action: Action) => void;
} | null>(null);
export function SenderActionItems({
  id,
  close,
}: {
  id: string;
  close: () => void;
}) {
  const actions = useContext(SenderActions);
  if (!actions?.allows(id)) return null;
  return (
    <>
      {(
        [
          ["private", "频道内私聊", <MessageSquare size={14} />],
          ["fork", "Fork · 分叉为新成员", <GitFork size={14} />],
          ["side", "Side · 打开独立侧聊", <MessagesSquare size={14} />],
        ] as const
      ).map(([action, label, icon]) => (
        <MenuItem
          key={action}
          icon={icon}
          disabled={hasUnresolvedIntents()}
          onClick={() => {
            close();
            actions.run(id, action);
          }}
        >
          {label}
        </MenuItem>
      ))}
    </>
  );
}
export function SenderActionsProvider({
  client,
  room,
  controlRoomId,
  members,
  enabled,
  onOpenPrivate,
  onBranched,
  children,
}: {
  client: RahClient;
  room: Room;
  controlRoomId?: string;
  members: readonly Principal[];
  enabled: boolean;
  onOpenPrivate: (id: string) => void;
  onBranched: () => void;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<{
    id: string;
    mode: "fork" | "side";
    request: number;
  }>();
  const allows = (id: string) =>
    enabled &&
    !!controlRoomId &&
    !room.side &&
    !room.instancePrivateBox &&
    !room.archivedAt &&
    members.some((m) => m.kind === "agent" && m.principalId === id);
  return (
    <SenderActions.Provider
      value={{
        allows,
        run: (id, action) => {
          if (!allows(id) || hasUnresolvedIntents()) return;
          if (action === "private") onOpenPrivate(id);
          else
            setTarget((previous) => ({
              id,
              mode: action,
              request: (previous?.request ?? 0) + 1,
            }));
        },
      }}
    >
      {children}
      {target && controlRoomId && (
        <SenderBranchRequest
          key={target.request}
          client={client}
          room={room}
          controlRoomId={controlRoomId}
          target={target}
          onClose={() => setTarget(undefined)}
          onBranched={onBranched}
        />
      )}
    </SenderActions.Provider>
  );
}
function SenderBranchRequest({
  client,
  room,
  controlRoomId,
  target,
  onClose,
  onBranched,
}: {
  client: RahClient;
  room: Room;
  controlRoomId: string;
  target: { id: string; mode: "fork" | "side" };
  onClose: () => void;
  onBranched: () => void;
}) {
  const [instance, setInstance] =
      useState<RoleListResponse["instances"][number]>(),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void client
      .request("role.list", { controlRoomId }, { signal: abort.signal })
      .then((catalog) => {
        if (abort.signal.aborted) return;
        const instance = catalog.instances.find(
          (i) => i.instanceId === target.id,
        );
        if (!instance || instance.channelId !== room.roomId)
          throw Error("实例不属于当前频道。");
        setInstance(instance);
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError("无法核实此频道的实例身份，请关闭后重试。");
      });
    return () => abort.abort();
  }, [client, controlRoomId, room.roomId, target.id]);
  if (instance)
    return (
      <SenderBranchDialog
        client={client}
        room={room}
        instance={instance}
        mode={target.mode}
        onBranched={onBranched}
      />
    );
  return (
    <ConfirmDialog
      title="读取实例"
      message={error || "正在核实当前频道的实例身份…"}
      confirmLabel="正在读取"
      confirmDisabled
      onClose={onClose}
      onConfirm={() => {}}
    />
  );
}
function SenderBranchDialog({
  client,
  room,
  instance,
  mode,
  onBranched,
}: {
  client: RahClient;
  room: Room;
  instance: RoleListResponse["instances"][number];
  mode: "fork" | "side";
  onBranched: () => void;
}) {
  const branch = useInstanceBranches(
    client,
    room.workspaceId,
    instance.agentId,
    instance,
    true,
    onBranched,
  );
  useEffect(() => {
    branch.begin(mode);
  }, [instance.instanceId, mode]);
  return branch.dialog;
}
