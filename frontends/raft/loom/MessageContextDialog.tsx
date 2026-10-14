import { useEffect, useState, useRef } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogBody,
  Spinner,
} from "raft-ui";
import type { RahClient } from "@rah-os/client-sdk";
import { messageContext, type DiscoveryRow } from "./discovery-client.ts";
import { toOfficialMessage } from "./channel-client.ts";
import MessageItem from "../packages/web/src/components/message/MessageItem.tsx";
const noMentions = new Map();
export default function MessageContextDialog({
  client,
  row,
  onClose,
  onOpenRoom,
}: {
  client: RahClient;
  row: DiscoveryRow;
  onClose: () => void;
  onOpenRoom: (id: string) => Promise<void>;
}) {
  const [data, setData] =
    useState<Awaited<ReturnType<typeof messageContext>>>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [opening, setOpening] = useState(false);
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setData(undefined);
    setError("");
    void messageContext(client, row, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("上下文读取失败，消息可能已删除或访问权限已变化。");
      });
    return () => controller.abort();
  }, [client, row, retry]);
  useEffect(() => {
    if (data) target.current?.scrollIntoView({ block: "center" });
  }, [data]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !opening) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>消息上下文 · {row.roomName}</DialogTitle>
          <DialogClose disabled={opening} aria-label="关闭上下文" />
        </DialogHeader>
        <DialogBody className="min-h-0 overflow-y-auto">
          {error ? (
            <div role="alert">
              <p>{error}</p>
              <Button onClick={() => setRetry((v) => v + 1)}>
                重新读取上下文
              </Button>
            </div>
          ) : !data ? (
            <Spinner aria-label="正在读取上下文" />
          ) : (
            data.messages.map((message) => {
              const projected = toOfficialMessage(message, data.members);
              return (
                <div
                  key={message.messageId}
                  ref={
                    message.messageId === row.message.messageId
                      ? target
                      : undefined
                  }
                  data-context-message-id={message.messageId}
                  className={
                    message.messageId === row.message.messageId
                      ? "border-l-2 border-current"
                      : ""
                  }
                >
                  <MessageItem
                    message={projected}
                    mentionMap={noMentions}
                    channels={[]}
                    readOnlyProjection
                    readOnlySender={{
                      displayName:
                        message.actorId === row.message.actorId
                          ? row.senderName
                          : (projected.senderDisplayName ?? "已离开的成员"),
                      avatarUrl: null,
                      description: null,
                    }}
                    hideThreadActions
                  />
                </div>
              );
            })
          )}
        </DialogBody>
        <div className="border-t border-line-muted p-3">
          <p className="mb-2 text-xs text-foreground-muted">
            只读上下文；打开所属对话将显示最新消息。线程回复入口尚未迁入。
          </p>
          <Button
            disabled={!data || opening}
            onClick={() => {
              setOpening(true);
              void onOpenRoom(row.message.roomId)
                .then(onClose)
                .catch(() => {
                  setOpening(false);
                  setError("无法打开所属对话，请重试。");
                });
            }}
          >
            打开所属对话
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
