import { useWorkspaceEntities } from "./workspace-entity-context.tsx";
import type {
  ForwardedMessageBundle,
  NavigationTarget,
} from "@rah-os/protocol";

import {
  navigationSearch,
  shouldHandleClientNavigation,
} from "../navigation-target.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { MessageMarkdown } from "./message-markdown.tsx";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
import { MessageAttachments } from "./room-files.tsx";
import { formatRahDateTime } from "../date-time-presentation.ts";

export function ForwardedMessageBundleView({
  bundle,
  onOpenTarget,
}: {
  bundle: ForwardedMessageBundle;
  onOpenTarget?: ((target: NavigationTarget) => void) | undefined;
}) {
  const entities = useWorkspaceEntities();
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
          const actor = entities?.resolvePerson(item.actor) ?? item.actor;
          const author = actor.displayName || actor.handle;
          return (
            <article key={item.sourceMessageId}>
              {actor.avatarKey ? (
                <ProfileImageAvatar
                  avatarKey={actor.avatarKey}
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
                <MessageMarkdown
                  source={item.body}
                  mentions={item.mentions ?? []}
                  references={{
                    agents: entities?.agents() ?? [],
                    principals:
                      entities?.humans().map((member) => member.principal) ??
                      [],
                    rooms: [],
                    tasks: [],
                  }}
                />
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
  return formatRahDateTime(value, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
