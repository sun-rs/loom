import type {
  RoomEventDto,
  RoomListItem,
  RoomMessage,
  RoomSnapshot,
  RoomTaskListItem,
} from "@rah/runtime-protocol";

import {
  bootstrapRoom,
  listRoomTasks,
  readOlderRoomMessages,
  readRoomEvents,
} from "./room-api";

export interface RoomProjectionState {
  roomId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  snapshot: RoomSnapshot | null;
  messages: readonly RoomMessage[];
  tasks: readonly RoomTaskListItem[];
  taskListCursor: string | null;
  hasOlderTasks: boolean;
  viewingOlderTasks: boolean;
  /** Last canonical sequence actually materialized into this projection. */
  observedRoomSeq: number;
  /** Server head advertised for lag diagnostics; never valid for mutations. */
  canonicalHeadSeq: number;
  eventCursor: string | null;
  olderMessagesCursor: string | null;
  hasOlderMessages: boolean;
  viewingOlderMessages: boolean;
  syncing: boolean;
  error: string | null;
}

export interface RoomProjectionPorts {
  bootstrap: typeof bootstrapRoom;
  readEvents: typeof readRoomEvents;
  readOlderMessages: typeof readOlderRoomMessages;
  listTasks: typeof listRoomTasks;
}

const DEFAULT_PORTS: RoomProjectionPorts = {
  bootstrap: bootstrapRoom,
  readEvents: readRoomEvents,
  readOlderMessages: readOlderRoomMessages,
  listTasks: listRoomTasks,
};

const INITIAL_STATE: RoomProjectionState = Object.freeze({
  roomId: null,
  status: "idle",
  snapshot: null,
  messages: [],
  tasks: [],
  taskListCursor: null,
  hasOlderTasks: false,
  viewingOlderTasks: false,
  observedRoomSeq: 0,
  canonicalHeadSeq: 0,
  eventCursor: null,
  olderMessagesCursor: null,
  hasOlderMessages: false,
  viewingOlderMessages: false,
  syncing: false,
  error: null,
});

/**
 * The browser's only canonical Room projection owner. It retains a bounded
 * materialized message window and cursors, never an unbounded event history.
 */
export class RoomProjectionController {
  readonly #ports: RoomProjectionPorts;
  readonly #maxMessages: number;
  readonly #maxTasks: number;
  readonly #listeners = new Set<(state: RoomProjectionState) => void>();
  #state: RoomProjectionState = INITIAL_STATE;
  #revision = 0;
  #abort: AbortController | null = null;
  #syncPromise: Promise<void> | null = null;
  #latestMessages: RoomMessage[] = [];
  #latestOlderMessagesCursor: string | null = null;
  #latestHasOlderMessages = false;
  #latestTasks: RoomTaskListItem[] = [];
  #latestTaskListCursor: string | null = null;
  #latestHasOlderTasks = false;

  constructor(
    options: {
      ports?: RoomProjectionPorts;
      maxMessages?: number;
      maxTasks?: number;
    } = {},
  ) {
    this.#ports = options.ports ?? DEFAULT_PORTS;
    this.#maxMessages = options.maxMessages ?? 600;
    this.#maxTasks = options.maxTasks ?? 300;
    if (
      !Number.isSafeInteger(this.#maxMessages) ||
      this.#maxMessages < 100 ||
      this.#maxMessages > 2_000
    ) {
      throw new Error("Room maxMessages must be between 100 and 2000");
    }
    if (
      !Number.isSafeInteger(this.#maxTasks) ||
      this.#maxTasks < 100 ||
      this.#maxTasks > 1_000
    ) {
      throw new Error("Room maxTasks must be between 100 and 1000");
    }
  }

  state(): RoomProjectionState {
    return this.#state;
  }

  subscribe(listener: (state: RoomProjectionState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  async open(roomId: string): Promise<void> {
    const revision = ++this.#revision;
    this.#abort?.abort();
    const abort = new AbortController();
    this.#abort = abort;
    this.#latestMessages = [];
    this.#latestOlderMessagesCursor = null;
    this.#latestHasOlderMessages = false;
    this.#latestTasks = [];
    this.#latestTaskListCursor = null;
    this.#latestHasOlderTasks = false;
    this.#set({
      ...INITIAL_STATE,
      roomId,
      status: "loading",
    });
    try {
      const [bootstrap, taskPage] = await Promise.all([
        this.#ports.bootstrap(
          { roomId, limit: Math.min(this.#maxMessages, 200) },
          abort.signal,
        ),
        this.#ports.listTasks({ roomId, limit: 100 }, abort.signal),
      ]);
      if (revision !== this.#revision || abort.signal.aborted) return;
      this.#latestMessages = this.#tail(bootstrap.recentMessages);
      this.#latestOlderMessagesCursor = bootstrap.olderMessagesCursor ?? null;
      this.#latestHasOlderMessages = Boolean(bootstrap.olderMessagesCursor);
      this.#latestTasks = taskPage.items.slice(-this.#maxTasks);
      this.#latestTaskListCursor = taskPage.taskListCursor ?? null;
      this.#latestHasOlderTasks = taskPage.hasMore;
      this.#set({
        roomId,
        status: "ready",
        snapshot: bootstrap.snapshot,
        messages: this.#latestMessages,
        tasks: this.#latestTasks,
        taskListCursor: taskPage.taskListCursor ?? null,
        hasOlderTasks: taskPage.hasMore,
        viewingOlderTasks: false,
        observedRoomSeq: bootstrap.snapshotSeq,
        canonicalHeadSeq: bootstrap.latestRoomSeq,
        eventCursor: bootstrap.eventCursor,
        olderMessagesCursor: bootstrap.olderMessagesCursor ?? null,
        hasOlderMessages: Boolean(bootstrap.olderMessagesCursor),
        viewingOlderMessages: false,
        syncing: false,
        error: null,
      });
    } catch (error) {
      if (revision !== this.#revision || abort.signal.aborted) return;
      this.#set({
        ...this.#state,
        status: "error",
        error: this.#message(error),
        syncing: false,
      });
    }
  }

  sync(maxPages = 4): Promise<void> {
    if (this.#syncPromise) return this.#syncPromise;
    const roomId = this.#state.roomId;
    const cursor = this.#state.eventCursor;
    if (!roomId || !cursor || this.#state.status !== "ready")
      return Promise.resolve();
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 20) {
      return Promise.reject(
        new Error("Room sync maxPages must be between 1 and 20"),
      );
    }
    const revision = this.#revision;
    const signal = this.#abort?.signal;
    this.#set({ ...this.#state, syncing: true, error: null });
    const operation = (async () => {
      let nextCursor = cursor;
      let observedRoomSeq = this.#state.observedRoomSeq;
      let canonicalHeadSeq = this.#state.canonicalHeadSeq;
      let messages = [...this.#latestMessages];
      let snapshot = this.#state.snapshot;
      let tasksDirty = false;
      for (let page = 0; page < maxPages; page += 1) {
        const result = await this.#ports.readEvents(
          { roomId, cursor: nextCursor, limit: 200 },
          signal,
        );
        if (revision !== this.#revision || signal?.aborted) return;
        nextCursor = result.eventCursor;
        canonicalHeadSeq = result.latestRoomSeq;
        for (const event of result.events) {
          const folded = this.#foldEvent(event, snapshot, messages);
          snapshot = folded.snapshot;
          messages = folded.messages;
          tasksDirty ||=
            event.aggregateType === "task" || event.aggregateType === "review";
          observedRoomSeq = Math.max(observedRoomSeq, event.roomSeq);
        }
        if (!result.hasMore) break;
      }
      const tasks = tasksDirty
        ? await this.#ports.listTasks({ roomId, limit: 100 }, signal)
        : null;
      if (revision !== this.#revision || signal?.aborted) return;
      this.#latestMessages = this.#tail(messages);
      if (tasks) {
        this.#latestTasks = tasks.items.slice(-this.#maxTasks);
        this.#latestTaskListCursor = tasks.taskListCursor ?? null;
        this.#latestHasOlderTasks = tasks.hasMore;
      }
      this.#set({
        ...this.#state,
        snapshot,
        messages: this.#state.viewingOlderMessages
          ? this.#state.messages
          : this.#latestMessages,
        tasks: tasks
          ? this.#state.viewingOlderTasks
            ? this.#state.tasks
            : this.#latestTasks
          : this.#state.tasks,
        taskListCursor: tasks
          ? this.#state.viewingOlderTasks
            ? this.#state.taskListCursor
            : this.#latestTaskListCursor
          : this.#state.taskListCursor,
        hasOlderTasks: tasks
          ? this.#state.viewingOlderTasks
            ? this.#state.hasOlderTasks
            : this.#latestHasOlderTasks
          : this.#state.hasOlderTasks,
        eventCursor: nextCursor,
        observedRoomSeq,
        canonicalHeadSeq,
        syncing: false,
      });
    })()
      .catch((error) => {
        if (revision === this.#revision && !signal?.aborted) {
          this.#set({
            ...this.#state,
            syncing: false,
            error: this.#message(error),
          });
        }
      })
      .finally(() => {
        if (this.#syncPromise === operation) this.#syncPromise = null;
      });
    this.#syncPromise = operation;
    return operation;
  }

  async loadOlder(): Promise<void> {
    const { roomId, olderMessagesCursor } = this.#state;
    if (!roomId || !olderMessagesCursor || this.#state.status !== "ready")
      return;
    const revision = this.#revision;
    const signal = this.#abort?.signal;
    try {
      const result = await this.#ports.readOlderMessages(
        {
          roomId,
          cursor: olderMessagesCursor,
          limit: 100,
        },
        signal,
      );
      if (revision !== this.#revision || signal?.aborted) return;
      const byId = new Map<string, RoomMessage>();
      for (const message of [...result.messages, ...this.#state.messages]) {
        byId.set(message.messageId, message);
      }
      const messages = [...byId.values()].sort(
        (left, right) => left.roomSeq - right.roomSeq,
      );
      this.#set({
        ...this.#state,
        messages: messages.slice(0, this.#maxMessages),
        olderMessagesCursor: result.olderMessagesCursor ?? null,
        hasOlderMessages: result.hasMore,
        viewingOlderMessages: true,
      });
    } catch (error) {
      if (revision === this.#revision && !signal?.aborted) {
        this.#set({ ...this.#state, error: this.#message(error) });
      }
    }
  }

  returnToLatest(): void {
    if (this.#state.status !== "ready" || !this.#state.viewingOlderMessages)
      return;
    this.#set({
      ...this.#state,
      messages: this.#latestMessages,
      olderMessagesCursor: this.#latestOlderMessagesCursor,
      hasOlderMessages: this.#latestHasOlderMessages,
      viewingOlderMessages: false,
    });
  }

  async loadOlderTasks(): Promise<void> {
    const { roomId, taskListCursor } = this.#state;
    if (!roomId || !taskListCursor || this.#state.status !== "ready") return;
    const revision = this.#revision;
    const signal = this.#abort?.signal;
    try {
      const result = await this.#ports.listTasks(
        {
          roomId,
          cursor: taskListCursor,
          limit: 100,
        },
        signal,
      );
      if (revision !== this.#revision || signal?.aborted) return;
      const byId = new Map<string, RoomTaskListItem>();
      for (const task of [...result.items, ...this.#state.tasks])
        byId.set(task.taskId, task);
      this.#set({
        ...this.#state,
        tasks: [...byId.values()]
          .sort((left, right) => left.taskNumber - right.taskNumber)
          .slice(0, this.#maxTasks),
        taskListCursor: result.taskListCursor ?? null,
        hasOlderTasks: result.hasMore,
        viewingOlderTasks: true,
      });
    } catch (error) {
      if (revision === this.#revision && !signal?.aborted) {
        this.#set({ ...this.#state, error: this.#message(error) });
      }
    }
  }

  returnToLatestTasks(): void {
    if (this.#state.status !== "ready" || !this.#state.viewingOlderTasks)
      return;
    this.#set({
      ...this.#state,
      tasks: this.#latestTasks,
      taskListCursor: this.#latestTaskListCursor,
      hasOlderTasks: this.#latestHasOlderTasks,
      viewingOlderTasks: false,
    });
  }

  close(): void {
    this.#revision += 1;
    this.#abort?.abort();
    this.#abort = null;
    this.#listeners.clear();
    this.#latestMessages = [];
    this.#latestOlderMessagesCursor = null;
    this.#latestHasOlderMessages = false;
    this.#latestTasks = [];
    this.#latestTaskListCursor = null;
    this.#latestHasOlderTasks = false;
    this.#state = INITIAL_STATE;
  }

  #foldEvent(
    event: RoomEventDto,
    snapshot: RoomSnapshot | null,
    messages: RoomMessage[],
  ): { snapshot: RoomSnapshot | null; messages: RoomMessage[] } {
    if (event.type === "message.posted") {
      const message: RoomMessage = {
        messageId: event.aggregateId,
        roomId: event.roomId,
        roomSeq: event.roomSeq,
        actorId: event.actorId,
        body: event.payload.body,
        ...(event.payload.reference
          ? {
              threadId: event.payload.reference.threadId,
              rootMessageId: event.payload.reference.rootMessageId,
              replyToMessageId: event.payload.reference.replyToMessageId,
            }
          : {}),
        createdAt: event.payload.createdAt,
      };
      const withoutDuplicate = messages.filter(
        (candidate) => candidate.messageId !== message.messageId,
      );
      return { snapshot, messages: [...withoutDuplicate, message] };
    }
    if (event.type === "membership.added" && snapshot) {
      return {
        snapshot: {
          ...snapshot,
          memberships: [...snapshot.memberships, event.payload.membership],
          principals: [...snapshot.principals, event.payload.principal],
        },
        messages,
      };
    }
    return { snapshot, messages };
  }

  #tail(messages: readonly RoomMessage[]): RoomMessage[] {
    return messages.slice(Math.max(0, messages.length - this.#maxMessages));
  }

  #message(error: unknown): string {
    return error instanceof Error
      ? error.message
      : "Room synchronization failed";
  }

  #set(state: RoomProjectionState): void {
    this.#state = Object.freeze(state);
    for (const listener of this.#listeners) listener(this.#state);
  }
}

export function roomListLabel(item: RoomListItem): string {
  return item.room.kind === "direct"
    ? (item.directPeer?.displayName ??
        item.directPeer?.handle ??
        item.room.name)
    : item.room.name;
}
