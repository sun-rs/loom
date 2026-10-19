// Structural port: Raft v1.21.22 Rxt form, dk FormSection, B7 action and drawer footer.
// Kernel metadata and SDK sidebar preferences remain the only business owners.
import { useEffect, useState, type ReactNode } from "react";
import { RoomSession } from "@rah-os/client-core";
import type { Room, SidebarPreferences } from "@rah-os/protocol";
import { Archive, ArchiveRestore } from "lucide-react";
import {
  Button,
  Input,
  Textarea,
  Field,
  FieldLabel,
  LabelAsterisk,
  LabelOptional,
  DrawerBody,
  DrawerFooter,
  FormSection,
  Switch,
  Separator,
} from "raft-ui";
import type { LoomChannelClient } from "./channel-client.ts";
import type { ManagementClient } from "./management-client.ts";
import { OperationStatus } from "./ManagementUi.tsx";
import { useDraftNavigation } from "./DraftNavigation.tsx";
import ChannelArchiveDialog from "./ChannelArchiveDialog.tsx";
import { channelMetadataPayload } from "./channel-settings.ts";
import { sidebarKey } from "./sidebar-state.ts";
export default function ChannelSettingsContent({
  bridge,
  manager,
  busy,
  members,
  children,
  onDirty,
  onClose,
  onSaved,
  onChanged,
}: {
  bridge: LoomChannelClient;
  manager: ManagementClient;
  busy: boolean;
  members: ReactNode;
  children: ReactNode;
  onDirty: (dirty: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
  onChanged: () => Promise<void>;
}) {
  const [base, setBase] = useState<{ room: Room; basis: number }>();
  const [preferences, setPreferences] = useState<SidebarPreferences>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [prefsError, setPrefsError] = useState("");
  const [tick, setTick] = useState(0);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [rejected, setRejected] = useState(false);
  const dirty =
    !!base &&
    (name !== base.room.name || description !== (base.room.description ?? ""));
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useDraftNavigation(dirty, () => {
    if (base) {
      setName(base.room.name);
      setDescription(base.room.description ?? "");
    }
  });
  useEffect(() => {
    let alive = true;
    const abort = new AbortController();
    setReadError("");
    setBase(undefined);
    const reader = new RoomSession({
      client: bridge.client,
      roomId: bridge.roomId,
      consumerId: `loom-channel-settings:${crypto.randomUUID()}`,
    });
    void reader
      .syncUntilCurrent({ maxPages: 10 })
      .then((result) => {
        if (!result.caughtUp || !result.state.snapshot?.room)
          throw Error("not current");
        if (alive) {
          const room = result.state.snapshot.room;
          setBase({ room, basis: result.state.latestRoomSeq });
          setName(room.name);
          setDescription(room.description ?? "");
          setRejected(false);
          setError("");
        }
      })
      .catch(() => {
        if (alive) setReadError("无法读取频道资料，请重试。");
      });
    void bridge.client
      .request(
        "sidebar.get",
        { workspaceId: manager.workspaceId },
        { signal: abort.signal },
      )
      .then((result) => {
        if (alive) {
          setPreferences(result.preferences);
          setPrefsError("");
        }
      })
      .catch(() => {
        if (alive) setPrefsError("无法读取通知偏好。");
      });
    return () => {
      alive = false;
      abort.abort();
    };
  }, [bridge, manager, tick]);
  const refreshPreferences = async () => {
    try {
      const value = await bridge.client.request("sidebar.get", {
        workspaceId: manager.workspaceId,
      });
      setPreferences(value.preferences);
      setPrefsError("");
      window.dispatchEvent(new Event("loom:sidebar-preferences-changed"));
    } catch {
      setPrefsError("无法读取通知偏好。");
    }
  };
  const saved = async () => {
    try {
      await onChanged();
      onDirty(false);
      onSaved();
    } catch {
      setError("已保存，但刷新频道失败。请关闭后刷新页面，不要重复保存。");
      setRejected(true);
    }
  };
  const submit = async () => {
    if (
      !base ||
      busy ||
      rejected ||
      !dirty ||
      !name.trim() ||
      base.room.archivedAt
    )
      return;
    setError("");
    await manager.writes.submitRevisioned({
      action: "channel-metadata",
      payload: channelMetadataPayload(base.room, base.basis, name, description),
      send: (payload, idempotencyKey) =>
        bridge.client.request("room.update", { ...payload, idempotencyKey }),
      onSettled: (outcome) => {
        if (outcome.kind === "ok") void saved();
        else if (outcome.kind === "rejected") {
          setRejected(true);
          setError(
            "资料未保存，频道可能已变化。你的草稿已保留；重新读取后再修改。",
          );
        }
      },
    });
  };
  const mute = (muted: boolean) => {
    if (!preferences || !base || busy) return;
    const key = sidebarKey(base.room);
    setPrefsError("");
    void manager.sidebar(
      {
        mutedActivity: muted
          ? [...new Set([...preferences.mutedActivity, key])]
          : preferences.mutedActivity.filter((x) => x !== key),
      },
      preferences.version,
      (outcome) => {
        if (outcome.kind === "ok") void refreshPreferences();
        else if (outcome.kind === "rejected") {
          setPrefsError("通知偏好已变化，请重新读取后再操作。");
          setPreferences(undefined);
        }
      },
    );
  };
  const archive = (room: Room, value: boolean) => {
    if (busy) return;
    setError("");
    void manager.archive(room.roomId, value, (outcome) => {
      if (outcome.kind === "ok") {
        setConfirmArchive(false);
        void saved();
      } else if (outcome.kind === "rejected")
        setError("频道状态未更改，可能仍有活动工作。请检查后重试。");
    });
  };
  return (
    <>
      <DrawerBody className="min-h-0 flex-1 overflow-y-auto">
        <form
          id="loom-channel-settings-form"
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <OperationStatus manager={manager} error={error} />
          {readError ? (
            <div role="alert">
              {readError}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setTick((x) => x + 1)}
              >
                重新读取频道资料
              </Button>
            </div>
          ) : !base ? (
            <p role="status">正在读取频道资料…</p>
          ) : (
            <section className="space-y-3">
              <div className="space-y-3">
                <Field>
                  <FieldLabel size="md" htmlFor="channel-settings-name">
                    名称
                    <LabelAsterisk className="ml-1" />
                  </FieldLabel>
                  <Input
                    autoFocus
                    id="channel-settings-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full"
                    required
                    disabled={
                      busy || !!base.room.archivedAt || base.room.slug === "all"
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel size="md" htmlFor="channel-settings-description">
                    描述<LabelOptional className="ml-1">可选</LabelOptional>
                  </FieldLabel>
                  <Textarea
                    id="channel-settings-description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="w-full"
                    rows={2}
                    maxLength={2000}
                    disabled={busy || !!base.room.archivedAt}
                  />
                </Field>
                {rejected && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setTick((x) => x + 1)}
                  >
                    重新读取频道资料
                  </Button>
                )}
              </div>
              <Separator className="mt-5" />
            </section>
          )}
        </form>
        <div className="space-y-5 mt-5">
          <div inert={busy || dirty}>{members}</div>
          <FormSection title="通知">
            <div className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <h4 className="text-subhead font-medium text-foreground">
                  静音动态
                </h4>
                <p className="mt-0.5 text-footnote text-foreground-hint">
                  与聊天列表的静音设置一致，不影响实例接收消息。
                </p>
              </div>
              <Switch
                aria-label="静音动态"
                checked={
                  !!(
                    base &&
                    preferences?.mutedActivity.includes(sidebarKey(base.room))
                  )
                }
                disabled={busy || !base || !preferences}
                onCheckedChange={mute}
              />
            </div>
            {prefsError && (
              <p role="alert">
                {prefsError}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void refreshPreferences()}
                >
                  重新读取通知偏好
                </Button>
              </p>
            )}
          </FormSection>
          <FormSection title="操作">
            <div className="flex flex-col gap-3">
              {children}
              {base && base.room.slug !== "all" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full justify-start text-left [&_[data-slot=button-content]]:w-full [&_[data-slot=button-content]]:justify-start"
                  disabled={busy || dirty}
                  onClick={() =>
                    base.room.archivedAt
                      ? archive(base.room, false)
                      : setConfirmArchive(true)
                  }
                >
                  {base.room.archivedAt ? (
                    <ArchiveRestore size={16} />
                  ) : (
                    <Archive size={16} />
                  )}
                  <span>{base.room.archivedAt ? "恢复频道" : "归档频道"}</span>
                </Button>
              )}
            </div>
          </FormSection>
        </div>
      </DrawerBody>
      <DrawerFooter className="safe-bottom">
        <div className="flex w-full justify-end gap-2">
          <Button size="lg" variant="ghost" disabled={busy} onClick={onClose}>
            取消
          </Button>
          {!base?.room.archivedAt && (
            <Button
              size="lg"
              variant="accent"
              type="submit"
              form="loom-channel-settings-form"
              disabled={busy || !base || !dirty || !name.trim() || rejected}
            >
              保存更改
            </Button>
          )}
        </div>
      </DrawerFooter>
      {confirmArchive && base && (
        <ChannelArchiveDialog
          target={base.room}
          archivedRooms={[]}
          manager={manager}
          error={error}
          busy={busy}
          onClose={() => {
            if (!busy) setConfirmArchive(false);
          }}
          onChange={archive}
          onOpen={() => {}}
        />
      )}
    </>
  );
}
