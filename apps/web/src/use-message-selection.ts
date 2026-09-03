import { useSyncExternalStore } from "react";

import {
  createMessageSelectionStore,
  type MessageSelectionScope,
} from "./message-selection-model.ts";

const selectionStore = createMessageSelectionStore();

export function messageSelectionMatches(
  scope: MessageSelectionScope | undefined,
  roomId: string | undefined,
  threadRootMessageId?: string,
): boolean {
  return (
    roomId !== undefined &&
    scope?.roomId === roomId &&
    scope.threadRootMessageId === threadRootMessageId
  );
}

export function useMessageSelection() {
  const snapshot = useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSnapshot,
    selectionStore.getSnapshot,
  );
  return { ...snapshot, ...selectionStore };
}
