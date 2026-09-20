import { useState } from "react";
import type { Room } from "@rah-os/protocol";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { formatRahDateTime } from "../date-time-presentation.ts";
import { SettingsSectionLabel } from "./settings-primitives.tsx";
import { RoomDeleteConfirmation } from "./room-dialogs.tsx";
import { HintTooltip } from "@rah-os/ui-web/neo-brutalist/tooltip";

export function SettingsArchivedChannels({
  rooms,
  onOpen,
  onUnarchive,
  onDelete,
}: {
  rooms: readonly Room[];
  onOpen: (roomId: string) => void;
  onUnarchive: (room: Room) => Promise<void>;
  onDelete?: (room: Room) => Promise<void>;
}) {
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState<Room>();
  const [deleteError, setDeleteError] = useState<string>();
  const archived = rooms
    .filter((room) => room.kind === "channel" && room.archivedAt !== undefined)
    .sort(
      (a, b) =>
        b.archivedAt!.localeCompare(a.archivedAt!) ||
        a.name.localeCompare(b.name),
    );
  if (archived.length === 0) return null;
  return (
    <section aria-label="已归档频道" className="rah-settings-archives">
      <SettingsSectionLabel icon="archive">
        已归档频道 <span>{archived.length}</span>
      </SettingsSectionLabel>
      {error && (
        <p className="rah-inline-error" role="alert">
          {error}
        </p>
      )}
      {archived.map((room) => (
        <article key={room.roomId} className="rah-settings-archive-row">
          <div className="rah-settings-archive-identity">
            <span className="rah-settings-archive-icon">
              <Icon name={room.visibility === "private" ? "lock" : "hash"} />
            </span>
            <div>
              <button
                type="button"
                className="rah-settings-archive-name"
                onClick={() => onOpen(room.roomId)}
              >
                #{room.name}
              </button>
              <p>
                {room.visibility === "private" ? "私密频道" : "公开频道"} ·
                归档于{" "}
                {formatRahDateTime(room.archivedAt!, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            </div>
          </div>
          <div className="rah-settings-archive-actions">
            <button
              type="button"
              className="btn btn-green"
              disabled={pending !== undefined}
              onClick={async () => {
                setPending(room.roomId);
                setError(undefined);
                try {
                  await onUnarchive(room);
                } catch (failure) {
                  setError(
                    failure instanceof Error ? failure.message : "取消归档失败",
                  );
                } finally {
                  setPending(undefined);
                }
              }}
            >
              <Icon name="archive-restore" />
              {pending === room.roomId ? "取消归档中…" : "取消归档"}
            </button>
            {onDelete && (
              <HintTooltip content="删除频道" side="top">
                <button
                  type="button"
                  className="btn btn-red rah-settings-archive-delete"
                  aria-label={`删除频道 ${room.name}`}
                  disabled={pending !== undefined}
                  onClick={() => {
                    setDeleteError(undefined);
                    setDeleting(room);
                  }}
                >
                  <Icon name="trash-2" />
                </button>
              </HintTooltip>
            )}
          </div>
        </article>
      ))}
      {deleting && onDelete && (
        <RoomDeleteConfirmation
          name={deleting.name}
          blocked={pending !== undefined}
          {...(deleteError ? { error: deleteError } : {})}
          onCancel={() => setDeleting(undefined)}
          onConfirm={async () => {
            if (pending !== undefined) return;
            setPending(deleting.roomId);
            setDeleteError(undefined);
            try {
              await onDelete(deleting);
              setDeleting(undefined);
            } catch (failure) {
              setDeleteError(
                failure instanceof Error ? failure.message : "删除频道失败",
              );
            } finally {
              setPending(undefined);
            }
          }}
        />
      )}
    </section>
  );
}
