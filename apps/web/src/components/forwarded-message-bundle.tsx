import type {
  ForwardedMessageBundle,
  NavigationTarget,
} from "@rah-os/protocol";

import {
  navigationSearch,
  shouldHandleClientNavigation,
} from "../navigation-target.ts";
import { Icon } from "./icon.tsx";
import { MessageMarkdown } from "./message-markdown.tsx";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
import { MessageAttachments } from "./room-files.tsx";

export function ForwardedMessageBundleView({
  bundle,
  onOpenTarget,
}: {
  bundle: ForwardedMessageBundle;
  onOpenTarget?: ((target: NavigationTarget) => void) | undefined;
}) {
  return (
    <section className="rah-forwarded-bundle" data-testid="forwarded-bundle">
      <header>
        <Icon name="send" />
        <strong>转发自 #{bundle.sourceRoom.name}</strong>
        <span>{bundle.items.length} 条消息</span>
      </header>
      <div>
        {bundle.items.map((item) => {
          const target: Extract<NavigationTarget, { kind: "message" }> = {
            kind: "message",
            messageId: item.sourceMessageId,
            roomId: bundle.sourceRoom.roomId,
            ...(item.isThreadChild
              ? {
                  rootMessageId: item.sourceRootMessageId,
                  threadId: item.sourceThreadId,
                }
              : {}),
          };
          const author = item.actor.displayName ?? item.actor.handle;
          return (
            <article key={item.sourceMessageId}>
              {item.actor.avatarKey ? (
                <ProfileImageAvatar
                  avatarKey={item.actor.avatarKey}
                  name={author}
                  size="compact"
                />
              ) : (
                <span className="avatar xs rah-avatar" aria-hidden="true">
                  {author.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div>
                <header>
                  <b>{author}</b>
                  <time>{formatTime(item.createdAt)}</time>
                  <a
                    href={navigationSearch({ target })}
                    onClick={(event) => {
                      if (
                        onOpenTarget === undefined ||
                        !shouldHandleClientNavigation(event)
                      )
                        return;
                      event.preventDefault();
                      onOpenTarget(target);
                    }}
                  >
                    查看原消息
                  </a>
                </header>
                <MessageMarkdown source={item.body} />
                {item.attachmentPolicy === "projected" ? (
                  <MessageAttachments attachments={item.attachments} />
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    hour12: document.documentElement.dataset.rahTimeFormat === "12",
    minute: "2-digit",
  }).format(new Date(value));
}
