import { SectionCreateDialog } from "./section-create-dialog.tsx";
import { useState, type ReactElement } from "react";
import {
  ContextActions,
  type ContextAction,
} from "@rah-os/ui-web/neo-brutalist/context-actions";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useSidebarPreferences } from "./sidebar-preferences.tsx";
import { RoomArchiveConfirmation } from "./room-dialogs.tsx";
import { browserOpaqueId } from "../browser-opaque-id.ts";
export type ChatContextTarget = {
  key: string;
  name: string;
  roomId?: string | undefined;
  channel: boolean;
  permanent: boolean;
  hasUnread: boolean;
};
export type ChatContextControl = {
  onArchive: (roomId: string) => Promise<void>;
  onUnread: (roomId: string, unread: boolean) => Promise<void>;
  onCloseConversation: (roomId: string | undefined) => void;
  onCreate: () => void;
  canCreate: boolean;
};
export function ChatContextActions({
  target,
  control,
  children,
}: {
  target?: ChatContextTarget;
  control: ChatContextControl;
  children: ReactElement;
}) {
  const prefs = useSidebarPreferences(),
    p = prefs?.data?.preferences;
  const [dialog, setDialog] = useState<"section" | "archive">(),
    [error, setError] = useState<string>();
  const disabled = !p || prefs?.pending;
  const save = async (
    patch: Parameters<NonNullable<typeof prefs>["patch"]>[0],
  ) => {
    if (!(await prefs?.patch(patch)))
      throw new Error("偏好保存失败，请刷新后重试");
  };
  const label = (icon: string, text: string) => (
    <>
      <Icon name={icon} />
      <span>{text}</span>
    </>
  );
  const run = (fn: () => Promise<unknown>) => {
    setError(undefined);
    void fn().catch((e) =>
      setError(e instanceof Error ? e.message : "操作失败"),
    );
  };
  const move = (sectionId?: string) => {
    if (!p || !target) return;
    run(() =>
      save({
        customSections: p.customSections.map((s) => ({
          ...s,
          items: [
            ...s.items.filter((k) => k !== target.key),
            ...(s.id === sectionId ? [target.key] : []),
          ],
        })),
        pinned: p.pinned.filter((k) => k !== target.key),
      }),
    );
  };
  let items: ContextAction[];
  if (target) {
    const pinned = p?.pinned.includes(target.key),
      muted = p?.mutedActivity.includes(target.key);
    items = [
      {
        key: "move",
        label: label("folder", "移动到分区"),
        disabled,
        children: [
          {
            key: "default",
            label: target.channel ? "频道" : "私信",
            onSelect: () => move(),
          },
          ...(p?.customSections ?? []).map((s) => ({
            key: s.id,
            label: [s.emoji, s.name].filter(Boolean).join(" "),
            onSelect: () => move(s.id),
          })),
          {
            key: "new",
            label: "新建分区",
            separator: true,
            onSelect: () => setDialog("section"),
          },
        ],
      },
      {
        key: "unread",
        label: label("chat", target.hasUnread ? "标为已读" : "标为未读"),
        separator: true,
        disabled: !target.roomId,
        onSelect: () =>
          run(() => control.onUnread(target.roomId!, !target.hasUnread)),
      },
      {
        key: "pin",
        label: label("pin", pinned ? "取消置顶" : "置顶"),
        disabled,
        onSelect: () =>
          p &&
          run(() =>
            save({
              pinned: pinned
                ? p.pinned.filter((k) => k !== target.key)
                : [...p.pinned, target.key],
              customSections: p.customSections.map((s) => ({
                ...s,
                items: s.items.filter((key) => key !== target.key),
              })),
            }),
          ),
      },
    ];
    if (target.channel) {
      items.push({
        key: "mute",
        label: label("bell-off", muted ? "取消静音" : "静音"),
        disabled,
        onSelect: () =>
          p &&
          run(() =>
            save({
              mutedActivity: muted
                ? p.mutedActivity.filter((k) => k !== target.key)
                : [...p.mutedActivity, target.key],
            }),
          ),
      });
      if (!target.permanent && control.canCreate)
        items.push({
          key: "archive",
          label: label("archive", "归档"),
          separator: true,
          onSelect: () => setDialog("archive"),
        });
    } else
      items.push({
        key: "close",
        label: label("x", "关闭会话"),
        separator: true,
        disabled,
        onSelect: () =>
          p &&
          run(async () => {
            await save({
              hiddenDms: [...new Set([...p.hiddenDms, target.key])],
            });
            control.onCloseConversation(target.roomId);
          }),
      });
  } else
    items = [
      {
        key: "create",
        label: label("hash", "创建频道"),
        disabled: !control.canCreate,
        onSelect: control.onCreate,
      },
      {
        key: "section",
        label: label("folder", "新建分区"),
        separator: true,
        disabled,
        onSelect: () => setDialog("section"),
      },
    ];
  return (
    <>
      <ContextActions
        trigger={children}
        label={target ? `${target.name} 菜单` : "聊天列表菜单"}
        items={items}
      />
      {error && <p role="alert">{error}</p>}
      {dialog && (
        <ContextDialog
          title={dialog === "section" ? "新建分区" : (target?.name ?? "")}
          needsName={dialog === "section"}
          onClose={() => setDialog(undefined)}
          onSubmit={async (name, emoji) => {
            if (dialog === "archive") await control.onArchive(target!.roomId!);
            else if (p)
              await save({
                customSections: [
                  ...p.customSections.map((s) => ({
                    ...s,
                    items: s.items.filter((k) => k !== target?.key),
                  })),
                  {
                    id: browserOpaqueId(),
                    name,
                    ...(emoji ? { emoji } : {}),
                    items: target ? [target.key] : [],
                  },
                ],
                ...(target
                  ? { pinned: p.pinned.filter((k) => k !== target.key) }
                  : {}),
              });
            setDialog(undefined);
          }}
        />
      )}
    </>
  );
}
function ArchiveContextDialog({
  title,
  onSubmit,
  onClose,
}: {
  title: string;
  needsName: boolean;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string>();
  return (
    <RoomArchiveConfirmation
      name={title}
      blocked={pending}
      error={error}
      onCancel={onClose}
      onConfirm={async () => {
        if (pending) return;
        setPending(true);
        setError(undefined);
        try {
          await onSubmit("");
        } catch (e) {
          setError(e instanceof Error ? e.message : "归档失败");
        } finally {
          setPending(false);
        }
      }}
    />
  );
}

function ContextDialog(props: {
  title: string;
  needsName: boolean;
  onSubmit: (name: string, emoji?: string | null) => Promise<void>;
  onClose: () => void;
}) {
  return props.needsName ? (
    <SectionCreateDialog onSubmit={props.onSubmit} onClose={props.onClose} />
  ) : (
    <ArchiveContextDialog {...props} />
  );
}
