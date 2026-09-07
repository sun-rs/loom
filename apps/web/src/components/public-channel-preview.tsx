import { useEffect, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { Room } from "@rah-os/protocol";
import { PanelHeader } from "@rah-os/ui-web/neo-brutalist/panel-header";
import { PanelHeaderIcon } from "@rah-os/ui-web/neo-brutalist/panel-header-icon";
import { PanelHeaderAction } from "@rah-os/ui-web/neo-brutalist/panel-header-action";
import { useDiscoveryQuery } from "../use-discovery-query.ts";
import { useReconciledQuery } from "../use-reconciled-query.ts";
import { opaqueIdFromBytes } from "@rah-os/ui-web";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { ConversationTabs } from "./conversation-tabs.tsx";
import { RoomFilesPane } from "./room-files.tsx";
import { createRoomViewModel } from "@rah-os/ui-web";
import { MessageArticle, TaskPane } from "./conversation-panes.tsx";
import { MessageSocialProvider } from "./message-social.tsx";

function PublicChannelPane({
  client,
  workspaceId,
  roomId,
  messageId,
  threadId,
  rootMessageId,
  tab,
  onSelectTab,
  onClose,
  onOpen,
  onJoined,
}: {
  client: RahClient;
  workspaceId: string;
  roomId: string;
  messageId?: string | undefined;
  threadId?: string | undefined;
  rootMessageId?: string | undefined;
  tab: "chat" | "tasks" | "files";
  onSelectTab: (tab: "chat" | "tasks" | "files") => void;
  onClose: () => void;
  onOpen: (
    roomId: string,
    messageId?: string,
    threadId?: string,
    rootMessageId?: string,
  ) => void;
  onJoined: (room: Room) => void;
}) {
  const [beforeTaskNumber, setBeforeTaskNumber] = useState<number>();
  const [page, setPage] = useState<{ beforeSeq?: number; ceilingSeq?: number }>(
    {},
  );
  const [revision, refresh] = useState(0),
    [error, setError] = useState<string>(),
    [pending, setPending] = useState(false);
  const query = useReconciledQuery(
    client,
    "room.preview",
    {
      workspaceId,
      roomId,
      view: tab === "tasks" ? "tasks" : "chat",
      ...(rootMessageId ? { rootMessageId } : {}),
      ...(beforeTaskNumber ? { beforeTaskNumber } : {}),
      ...(threadId ? { threadId, ...page } : messageId ? { messageId } : page),
    },
    true,
    revision,
  );
  const isThread = !!threadId || !!rootMessageId;
  const current = query?.error ? undefined : query?.data;
  const followers = useDiscoveryQuery(
    client,
    "thread.followers",
    { roomId, threadId: threadId ?? "none" },
    !!current && !!threadId,
  );
  const [followPending, setFollowPending] = useState(false);
  const toggleFollow = async () => {
    if (!threadId || !followers.data || followPending) return;
    setFollowPending(true);
    try {
      await client.request("activity.follow", {
        roomId,
        threadId,
        following: !followers.data.following,
      });
      if (live.current) followers.refresh();
    } catch (e) {
      if (live.current) setError(String(e));
    } finally {
      if (live.current) setFollowPending(false);
    }
  };
  useEffect(() => {
    if (current?.membership) onJoined(current.room);
  }, [current, onJoined]);
  const live = useRef(true),
    intent = useRef<{ roomSeq: number; key: string } | undefined>(undefined);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const join = async () => {
    if (!current || pending) return;
    const attempt = intent.current ?? {
      roomSeq: current.roomSeq,
      key: `public-join-${opaqueIdFromBytes(crypto.getRandomValues(new Uint8Array(16)))}`,
    };
    intent.current = attempt;
    setPending(true);
    setError(undefined);
    try {
      await client.request("room.public.join", {
        roomId,
        workspaceId,
        basedOnRoomSeq: attempt.roomSeq,
        idempotencyKey: attempt.key,
      });
      if (live.current) onJoined(current.room);
    } catch (e) {
      if (live.current) {
        setError(e instanceof Error ? e.message : "加入失败");
        refresh((n) => n + 1);
      }
    } finally {
      if (live.current) setPending(false);
    }
  };
  return (
    <section
      className="channel rah-public-preview-pane"
      aria-label={isThread ? "公开消息列" : "公开频道正文"}
    >
      <PanelHeader kind="conversation">
        <PanelHeaderAction
          className="rah-mobile-only"
          aria-label="关闭频道预览"
          onClick={onClose}
        >
          <Icon name="x" />
        </PanelHeaderAction>
        <PanelHeaderIcon name="hash" />
        <h2 className="rah-panel-title">
          {isThread ? "消息列" : (current?.room.name ?? "频道预览")}
        </h2>
        <div className="head-actions">
          {current && threadId && (
            <button
              className="btn"
              disabled={!followers.data || !!followers.error || followPending}
              onClick={() => void toggleFollow()}
            >
              {followers.data?.following ? "取消关注" : "关注"}
            </button>
          )}
        </div>
      </PanelHeader>
      {!isThread && <ConversationTabs value={tab} onSelect={onSelectTab} />}
      {isThread && (
        <button className="btn" onClick={() => onOpen(roomId)}>
          返回频道
        </button>
      )}
      {query?.error ? (
        <div role="alert">
          {query.error}
          <button className="btn" onClick={() => refresh((n) => n + 1)}>
            重试
          </button>
        </div>
      ) : !current ? (
        <p role="status">正在加载频道…</p>
      ) : (
        <>
          {tab === "files" ? (
            <RoomFilesPane
              roomId={roomId}
              onSource={(file) => {
                void client
                  .request("message.context", {
                    roomId,
                    messageId: file.messageId,
                  })
                  .then((context) => {
                    if (live.current)
                      onOpen(roomId, file.messageId, context.message.threadId);
                  })
                  .catch((e) => {
                    if (live.current) setError(String(e));
                  });
              }}
            />
          ) : tab === "tasks" ? (
            <TaskPane
              agents={[]}
              canManageAnyTask={false}
              canOpenThread={true}
              canWrite={false}
              caughtUp={true}
              client={client}
              columns={
                createRoomViewModel({
                  members: current.authors,
                  messages: [],
                  tasks: current.tasks ?? [],
                }).taskColumns
              }
              currentPrincipalId={undefined}
              earlierTasksLoading={false}
              hasEarlierTasks={!!current.nextBeforeTaskNumber}
              loading={false}
              onChanged={() => refresh((n) => n + 1)}
              onCreate={() => {}}
              onLoadEarlierTasks={async () =>
                setBeforeTaskNumber(current.nextBeforeTaskNumber)
              }
              onOpenThread={async (task) =>
                onOpen(roomId, task.sourceMessageId, task.threadId)
              }
              roomName={current.room.name}
            />
          ) : (
            <div className="rah-public-preview-messages">
              {current.nextBeforeSeq && (
                <button
                  className="btn"
                  onClick={() =>
                    setPage({
                      beforeSeq: current.nextBeforeSeq!,
                      ceilingSeq: current.ceilingSeq,
                    })
                  }
                >
                  查看较早消息
                </button>
              )}
              {page.beforeSeq && (
                <button className="btn" onClick={() => setPage({})}>
                  回到最新
                </button>
              )}
              {current.messages.length === 0 ? (
                <p>暂无消息</p>
              ) : (
                <MessageSocialProvider client={client} enabled={true}>
                  {current.messages.map((message) => (
                    <MessageArticle
                      key={message.messageId}
                      client={client}
                      {...(current.tasks?.find(
                        (t) => t.sourceMessageId === message.messageId,
                      )
                        ? {
                            task: current.tasks.find(
                              (t) => t.sourceMessageId === message.messageId,
                            )!,
                          }
                        : {})}
                      messagePrincipal={current.authors.find(
                        (p) => p.principalId === message.actorId,
                      )}
                      {...(() => {
                        const thread = current.threads.find(
                          (t) => t.rootMessageId === message.messageId,
                        );
                        return isThread
                          ? {}
                          : {
                              threadAction: {
                                onClick: () =>
                                  onOpen(
                                    roomId,
                                    message.messageId,
                                    thread?.threadId,
                                    message.messageId,
                                  ),
                              },
                              ...(thread
                                ? { threadReplyCount: thread.replyCount }
                                : {}),
                            };
                      })()}
                      focused={message.messageId === messageId}
                      message={{
                        actorId: message.actorId,
                        body: message.body,
                        createdAt: message.createdAt,
                        messageId: message.messageId,
                        roomId: message.roomId,
                        roomSeq: message.roomSeq,
                        ...(message.attachments
                          ? { attachments: message.attachments }
                          : {}),
                        ...(message.forwardedBundle
                          ? { forwardedBundle: message.forwardedBundle }
                          : {}),
                        author:
                          current.authors.find(
                            (p) => p.principalId === message.actorId,
                          )?.displayName ??
                          current.authors.find(
                            (p) => p.principalId === message.actorId,
                          )?.handle ??
                          "成员",
                      }}
                    />
                  ))}
                </MessageSocialProvider>
              )}
            </div>
          )}
          <div className="composer">
            {error && <p role="alert">{error}</p>}
            <button
              className="btn btn-pink rah-public-join"
              disabled={pending}
              onClick={join}
            >
              {pending
                ? "正在加入…"
                : isThread
                  ? "加入频道以回复"
                  : `加入 #${current.room.name}`}
            </button>
            {error && (
              <button
                className="btn"
                disabled={pending}
                onClick={() => {
                  intent.current = undefined;
                  setError(undefined);
                  refresh((n) => n + 1);
                }}
              >
                按最新状态重新加入
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function PublicChannelPreview(
  props: Parameters<typeof PublicChannelPane>[0],
) {
  return (
    <aside
      className={`channel rah-public-preview${props.threadId || props.rootMessageId ? " has-public-thread" : ""}`}
      aria-label="频道预览"
    >
      <PublicChannelPane
        {...props}
        messageId={
          props.threadId || props.rootMessageId ? undefined : props.messageId
        }
        threadId={undefined}
        rootMessageId={undefined}
      />
      {(props.threadId || props.rootMessageId) && (
        <PublicChannelPane
          {...props}
          key={props.threadId ?? props.rootMessageId}
          tab="chat"
        />
      )}
    </aside>
  );
}
