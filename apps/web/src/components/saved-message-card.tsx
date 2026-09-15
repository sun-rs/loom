import { useWorkspaceEntities } from "./workspace-entity-context.tsx";
import { activityDisplayText } from "../activity-display-names.ts";
import { useCallback, useRef, useState } from "react";

import {
  formatSavedRelativeTime,
  savedTargetLabel,
  type SavedMessage,
} from "../saved-messages-model.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { FloatingContextMenu } from "./floating-context-menu.tsx";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";

type Position = { x: number; y: number };

export function SavedMessageCard({
  onError,
  onOpen,
  onRemove,
  removing,
  row,
}: {
  onError: (message: string) => void;
  onOpen: () => void;
  onRemove: () => Promise<void>;
  removing: boolean;
  row: SavedMessage;
}) {
  const [menu, setMenu] = useState<Position>();
  const cardRef = useRef<HTMLDivElement>(null);
  const entities = useWorkspaceEntities();
  const sender = entities?.resolvePerson(row.sender) ?? row.sender;
  const senderName = sender.displayName || sender.handle || row.senderName;
  const closeMenu = useCallback(() => {
    setMenu(undefined);
  }, []);
  function openMenu(event: React.MouseEvent) {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      closeMenu();
    } catch (error) {
      onError(error instanceof Error ? error.message : "写入剪贴板失败");
    }
  }
  async function remove() {
    if (removing) return;
    closeMenu();
    await onRemove();
  }
  function cardKeyDown(event: React.KeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onOpen();
  }
  return (
    <>
      <div
        className="rah-saved-card"
        data-context-open={menu ? "true" : "false"}
        onClick={onOpen}
        onContextMenu={openMenu}
        onKeyDown={cardKeyDown}
        ref={cardRef}
        role="button"
        tabIndex={0}
      >
        <span className="rah-saved-card-copy">
          <span className="rah-saved-card-meta">
            <span className="rah-saved-target">
              {savedTargetLabel(row.roomKind, row.roomName, senderName)}
            </span>
            {row.rootMessageId ? (
              <span className="rah-saved-thread-label">
                <Icon name="message-square" />
                消息列
              </span>
            ) : null}
            <span className="rah-saved-sender">
              <span className="rah-saved-sender-avatar">
                <ProfileImageAvatar
                  avatarKey={sender.avatarKey}
                  name={senderName}
                  size="compact"
                />
              </span>
              <span>{senderName}</span>
            </span>
            <time>{formatSavedRelativeTime(row.message.createdAt)}</time>
          </span>
          <span className="rah-saved-message-body">
            {activityDisplayText(
              row.message.body,
              entities?.humans().map((member) => member.principal) ?? [],
            )}
          </span>
        </span>
        <span className="rah-saved-remove-wrap">
          <button
            aria-label="从收藏中移除"
            className="rah-saved-remove"
            disabled={removing}
            onClick={(event) => {
              event.stopPropagation();
              void remove();
            }}
            title="从收藏中移除"
            type="button"
          >
            <Icon className="rah-saved-filled-bookmark" name="bookmark" />
          </button>
          <span className="rah-saved-remove-tooltip">从收藏中移除</span>
        </span>
      </div>
      {menu ? (
        <FloatingContextMenu
          anchor={menu}
          ariaLabel="收藏消息操作"
          backdropClassName="rah-saved-context-backdrop"
          className="rah-saved-context-menu"
          onClose={closeMenu}
          triggerRef={cardRef}
        >
          <button
            onClick={() => void copy(row.message.body)}
            role="menuitem"
            type="button"
          >
            <Icon name="copy" />
            复制 Markdown
          </button>
          <hr />
          <button
            className="rah-saved-context-remove"
            disabled={removing}
            onClick={() => void remove()}
            role="menuitem"
            type="button"
          >
            <Icon className="rah-saved-filled-bookmark" name="bookmark" />
            从收藏中移除
          </button>
        </FloatingContextMenu>
      ) : null}
    </>
  );
}
