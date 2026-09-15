import { useCallback, useEffect, useId, useState } from "react";

import {
  resolveSelectedMessages,
  shouldExitMessageSelectionOnKeyDown,
} from "./message-selection-model.ts";
import {
  messageSelectionMatches,
  useMessageSelection,
} from "./use-message-selection.ts";

type SelectableMessage = {
  body: string;
  messageId: string;
  roomSeq: number;
};

export function useMessageSelectionActions<Message extends SelectableMessage>({
  linkForMessage,
  messages,
  roomId,
  threadRootMessageId,
  visible = true,
}: {
  linkForMessage: (message: Message) => string | undefined;
  messages: readonly Message[];
  roomId: string | undefined;
  threadRootMessageId?: string | undefined;
  visible?: boolean;
}) {
  const [error, setError] = useState<string>();
  const [forwardOpen, setForwardOpen] = useState(false);
  const selection = useMessageSelection();
  const ownerId = useId();
  const enterRoom = useCallback(
    (room: string, ids?: readonly string[]) =>
      selection.enterRoom(room, ids, ownerId),
    [selection.enterRoom, ownerId],
  );
  const enterThread = useCallback(
    (room: string, root: string, ids?: readonly string[]) =>
      selection.enterThread(room, root, ids, ownerId),
    [selection.enterThread, ownerId],
  );
  const active =
    selection.active &&
    selection.scope?.ownerId === ownerId &&
    messageSelectionMatches(selection.scope, roomId, threadRootMessageId);
  const resolved = resolveSelectedMessages(
    active ? selection.selectedIds : [],
    messages,
  );
  const selectableMessageIds = messages.map(({ messageId }) => messageId);
  const allSelected =
    selectableMessageIds.length > 0 &&
    resolved.messages.length === selectableMessageIds.length;

  useEffect(() => {
    if (!visible && active) selection.exit();
  }, [visible, active, selection.exit]);

  useEffect(
    () => () => {
      if (
        selection.getSnapshot().scope?.ownerId === ownerId &&
        messageSelectionMatches(
          selection.getSnapshot().scope,
          roomId,
          threadRootMessageId,
        )
      ) {
        selection.exit();
      }
    },
    [
      ownerId,
      roomId,
      selection.exit,
      selection.getSnapshot,
      threadRootMessageId,
    ],
  );
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !shouldExitMessageSelectionOnKeyDown({
          defaultPrevented: event.defaultPrevented,
          key: event.key,
          modalOpen: document.querySelector('[aria-modal="true"]') !== null,
        })
      )
        return;
      event.preventDefault();
      selection.exit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, selection.exit]);

  async function copy(kind: "links" | "markdown") {
    if (resolved.unresolvedCount > 0) {
      setError(
        `${String(resolved.unresolvedCount)} 条已选消息尚未载入，未复制任何内容。`,
      );
      return;
    }
    const values = resolved.messages.flatMap((message) => {
      if (kind === "markdown") return [message.body];
      const link = linkForMessage(message);
      return link === undefined
        ? []
        : [new URL(link, window.location.href).href];
    });
    if (values.length !== resolved.messages.length) {
      setError("无法解析全部消息链接，未复制任何内容。");
      return;
    }
    try {
      await navigator.clipboard.writeText(values.join("\n\n"));
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "复制消息失败");
    }
  }

  function openForward() {
    if (resolved.unresolvedCount > 0) {
      setError(
        `${String(resolved.unresolvedCount)} 条已选消息尚未载入，无法转发。`,
      );
      return;
    }
    if (resolved.messages.length === 0) return;
    setError(undefined);
    setForwardOpen(true);
  }

  return {
    active,
    allSelected,
    closeForward: () => setForwardOpen(false),
    copy,
    error,
    forwardOpen,
    openForward,
    resolved,
    selectableMessageIds,
    selection: { ...selection, enterRoom, enterThread },
  };
}
