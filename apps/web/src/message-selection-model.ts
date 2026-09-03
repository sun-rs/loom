export type MessageSelectionScope = {
  roomId: string;
  threadRootMessageId?: string;
};

export type MessageSelectionSnapshot = {
  active: boolean;
  scope: MessageSelectionScope | undefined;
  selectedIds: readonly string[];
};

export type MessageSelectionStore = {
  enterRoom: (roomId: string, initialIds?: readonly string[]) => void;
  enterThread: (
    roomId: string,
    threadRootMessageId: string,
    initialIds?: readonly string[],
  ) => void;
  exit: () => void;
  getSnapshot: () => MessageSelectionSnapshot;
  selectAll: (messageIds: readonly string[]) => void;
  subscribe: (listener: () => void) => () => void;
  toggle: (messageId: string) => void;
  toggleWithThread: (
    rootMessageId: string,
    replyMessageIds: readonly string[],
  ) => void;
};

export function shouldExitMessageSelectionOnKeyDown(input: {
  defaultPrevented: boolean;
  key: string;
  modalOpen: boolean;
}): boolean {
  return input.key === "Escape" && !input.defaultPrevented && !input.modalOpen;
}

const EMPTY_SELECTION: MessageSelectionSnapshot = {
  active: false,
  scope: undefined,
  selectedIds: [],
};

function selectedIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids.filter((id) => id.length > 0))].sort();
}

export function createMessageSelectionStore(): MessageSelectionStore {
  let snapshot = EMPTY_SELECTION;
  const listeners = new Set<() => void>();
  const update = (next: MessageSelectionSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  return {
    enterRoom(roomId, initialIds = []) {
      update({
        active: true,
        scope: { roomId },
        selectedIds: selectedIds(initialIds),
      });
    },
    enterThread(roomId, threadRootMessageId, initialIds) {
      update({
        active: true,
        scope: { roomId, threadRootMessageId },
        selectedIds: selectedIds(initialIds ?? [threadRootMessageId]),
      });
    },
    exit() {
      if (!snapshot.active) return;
      update(EMPTY_SELECTION);
    },
    getSnapshot() {
      return snapshot;
    },
    selectAll(messageIds) {
      if (!snapshot.active) return;
      update({ ...snapshot, selectedIds: selectedIds(messageIds) });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    toggle(messageId) {
      if (!snapshot.active || messageId.length === 0) return;
      const next = new Set(snapshot.selectedIds);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      update({ ...snapshot, selectedIds: selectedIds([...next]) });
    },
    toggleWithThread(rootMessageId, replyMessageIds) {
      if (!snapshot.active) return;
      const next = new Set(snapshot.selectedIds);
      const family = selectedIds([rootMessageId, ...replyMessageIds]);
      if (next.has(rootMessageId)) {
        for (const messageId of family) next.delete(messageId);
      } else {
        for (const messageId of family) next.add(messageId);
      }
      update({ ...snapshot, selectedIds: selectedIds([...next]) });
    },
  };
}

export function resolveSelectedMessages<
  Message extends { messageId: string; roomSeq: number },
>(selected: readonly string[], messages: readonly Message[]) {
  const byId = new Map(messages.map((message) => [message.messageId, message]));
  const resolved = selected.flatMap((messageId) => {
    const message = byId.get(messageId);
    return message === undefined ? [] : [message];
  });
  return {
    messages: resolved.sort(
      (left, right) =>
        left.roomSeq - right.roomSeq ||
        left.messageId.localeCompare(right.messageId),
    ),
    unresolvedCount: selected.length - resolved.length,
  };
}
