import type { NavigationTarget } from "@rah-os/protocol";
import type { RefObject } from "react";

import { navigationSearch } from "../navigation-target.ts";
import { FloatingContextMenu } from "./floating-context-menu.tsx";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import {
  QUICK_REACTIONS,
  ReactionGlyph,
  type MessageSocialView,
} from "./message-social.tsx";

export function MessageContextMenu({
  anchor,
  conversionPending = false,
  messageBody,
  onClose,
  onConvertToTask,
  onError,
  onOpenThread,
  onSelectMessages,
  social,
  target,
  triggerRef,
}: {
  anchor: { x: number; y: number };
  conversionPending?: boolean;
  messageBody: string;
  onClose: () => void;
  onConvertToTask?: () => Promise<void>;
  onError: (message: string) => void;
  onOpenThread?: () => void;
  onSelectMessages?: () => void;
  social: MessageSocialView;
  target: Extract<NavigationTarget, { kind: "message" }>;
  triggerRef: RefObject<HTMLElement | null>;
}) {
  const socialData = social.state?.data;
  const socialPending = social.state?.pending ?? false;

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : "写入剪贴板失败");
    }
  }

  return (
    <FloatingContextMenu
      anchor={anchor}
      ariaLabel="消息操作"
      backdropClassName="rah-message-context-backdrop"
      className="rah-message-context-menu"
      onClose={onClose}
      triggerRef={triggerRef}
    >
      {social.enabled ? (
        <div
          className="rah-message-context-reactions"
          data-message-affordance="reaction-quick-row"
        >
          {QUICK_REACTIONS.map((emoji) => {
            const active = Boolean(
              socialData?.reactions.some(
                (reaction) => reaction.emoji === emoji && reaction.mine,
              ),
            );
            return (
              <button
                aria-label={`用 ${emoji} 回应`}
                aria-checked={active}
                disabled={socialPending || !socialData}
                key={emoji}
                onClick={() => {
                  onClose();
                  void social.mutate("reaction", !active, emoji);
                }}
                role="menuitemradio"
                type="button"
              >
                <ReactionGlyph emoji={emoji} />
              </button>
            );
          })}
        </div>
      ) : null}
      {social.enabled ? <hr /> : null}
      <button
        onClick={() =>
          void copy(
            new URL(navigationSearch({ target }), window.location.href).href,
          )
        }
        role="menuitem"
        type="button"
      >
        <Icon name="link-2" />
        复制链接
      </button>
      <button
        onClick={() => void copy(messageBody)}
        role="menuitem"
        type="button"
      >
        <Icon name="copy" />
        复制 Markdown
      </button>
      {onSelectMessages ? (
        <button
          onClick={() => {
            onClose();
            onSelectMessages();
          }}
          role="menuitem"
          type="button"
        >
          <Icon name="listcheck" />
          选择消息
        </button>
      ) : null}
      <hr />
      {onOpenThread ? (
        <button
          onClick={() => {
            onClose();
            onOpenThread();
          }}
          role="menuitem"
          type="button"
        >
          <Icon name="chat" />
          在消息列中回复
        </button>
      ) : null}
      {social.enabled ? (
        <button
          disabled={socialPending || !socialData}
          onClick={() => {
            onClose();
            void social.mutate("save", !socialData?.saved);
          }}
          role="menuitem"
          type="button"
        >
          <Icon name="bookmark" />
          {socialData?.saved ? "从收藏中移除" : "收藏消息"}
        </button>
      ) : null}
      {onConvertToTask ? (
        <>
          <hr />
          <button
            disabled={conversionPending}
            onClick={() => void onConvertToTask()}
            role="menuitem"
            type="button"
          >
            <Icon name="task" />
            {conversionPending ? "正在转换…" : "转为任务"}
          </button>
        </>
      ) : null}
    </FloatingContextMenu>
  );
}
