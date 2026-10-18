import { uiActionProps } from "./ui-action-props.ts";
import { Button } from "raft-ui";
import type { Room } from "@rah-os/protocol";
import type { ManagementClient } from "./management-client.ts";
import { ActionDialog } from "./ManagementUi.tsx";
export default function ChannelArchiveDialog({
  target,
  archivedRooms,
  manager,
  error,
  busy,
  onClose,
  onChange,
  onOpen,
}: {
  target: Room | "list";
  archivedRooms: Room[];
  manager: ManagementClient;
  error: string;
  busy: boolean;
  onClose: () => void;
  onChange: (room: Room, archive: boolean) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <ActionDialog
      title={target === "list" ? "已归档频道" : "归档频道"}
      manager={manager}
      error={error}
      onClose={onClose}
    >
      {target === "list" ? (
        <div className="space-y-2">
          {!archivedRooms.length && <p>暂无已归档频道</p>}
          {archivedRooms.map((room) => (
            <div key={room.roomId} className="flex min-w-0 items-center gap-2">
              <Button
                variant="ghost"
                className="min-w-0 flex-1 truncate justify-start"
                disabled={busy}
                onClick={() => {
                  onClose();
                  onOpen(room.roomId);
                }}
              >
                {room.name}
              </Button>
              <Button
                {...uiActionProps.secondary}
                disabled={busy}
                aria-label={`恢复 ${room.name}`}
                onClick={() => onChange(room, false)}
              >
                恢复
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <p className="mb-4">
            归档“{target.name}
            ”？保留频道历史，停止新的频道写入。仍有活动工作时不能归档，可在已归档频道列表恢复。
          </p>
          <Button
            {...uiActionProps.confirmChange}
            disabled={busy}
            onClick={() => onChange(target, true)}
          >
            确认归档
          </Button>
        </>
      )}
    </ActionDialog>
  );
}
