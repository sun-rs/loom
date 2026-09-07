import type { RahClient } from "@rah-os/client-sdk";
import type { Task } from "@rah-os/protocol";

export const ACTIVE_ROOM_TASK_STATES = [
  "todo",
  "claimed",
  "in_progress",
  "waiting_input",
  "blocked",
  "submitted",
] as const satisfies readonly Task["state"][];

export type RoomTaskPageCursor = {
  activeBeforeTaskNumber?: number;
  recentBeforeTaskNumber?: number;
};

export type RoomTaskOverview = {
  nextPage?: RoomTaskPageCursor | undefined;
  tasks: Task[];
};

export const ROOM_TASK_EARLIER_PAGE_WINDOW = 3;
export const ROOM_TASK_WINDOW_ROOM_LIMIT = 8;

export type RoomTaskWindowPage = {
  cursor: RoomTaskPageCursor;
  overview: RoomTaskOverview;
};

export type RoomTaskWindow = {
  base: RoomTaskOverview;
  earlierPages: RoomTaskWindowPage[];
  nextPage?: RoomTaskPageCursor | undefined;
  tasks: Task[];
};

export function mergeRoomTaskPages(
  ...pages: readonly { tasks: readonly Task[] }[]
): Task[] {
  const byId = new Map<string, Task>();
  for (const page of pages) {
    for (const task of page.tasks) {
      const current = byId.get(task.taskId);
      if (current === undefined || current.updatedAt <= task.updatedAt) {
        byId.set(task.taskId, task);
      }
    }
  }
  return [...byId.values()].sort(
    (left, right) => left.taskNumber - right.taskNumber,
  );
}

export function createRoomTaskWindow(base: RoomTaskOverview): RoomTaskWindow {
  return roomTaskWindow(base, []);
}

export function appendRoomTaskWindowPage(
  current: RoomTaskWindow,
  cursor: RoomTaskPageCursor,
  overview: RoomTaskOverview,
): RoomTaskWindow {
  if (!sameRoomTaskPageCursor(current.nextPage, cursor)) return current;
  const earlierPages = [
    ...current.earlierPages,
    { cursor: { ...cursor }, overview },
  ].slice(-ROOM_TASK_EARLIER_PAGE_WINDOW);
  return roomTaskWindow(current.base, earlierPages);
}

export async function refreshRoomTaskWindow(
  client: RahClient,
  roomId: string,
  current: RoomTaskWindow | undefined,
  signal?: AbortSignal,
): Promise<RoomTaskWindow> {
  const [base, earlierPages] = await Promise.all([
    loadRoomTaskOverview(client, roomId, signal),
    Promise.all(
      (current?.earlierPages ?? []).map(async ({ cursor }) => ({
        cursor,
        overview: await loadEarlierRoomTaskOverview(
          client,
          roomId,
          cursor,
          signal,
        ),
      })),
    ),
  ]);
  return roomTaskWindow(base, earlierPages);
}

export function rememberRoomTaskWindow(
  windows: Map<string, RoomTaskWindow>,
  roomId: string,
  window: RoomTaskWindow,
) {
  windows.delete(roomId);
  windows.set(roomId, window);
  while (windows.size > ROOM_TASK_WINDOW_ROOM_LIMIT) {
    const oldest = windows.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    windows.delete(oldest);
  }
}

export function sameRoomTaskPageCursor(
  left: RoomTaskPageCursor | undefined,
  right: RoomTaskPageCursor | undefined,
) {
  return (
    left?.activeBeforeTaskNumber === right?.activeBeforeTaskNumber &&
    left?.recentBeforeTaskNumber === right?.recentBeforeTaskNumber
  );
}

export async function loadRoomTaskOverview(
  client: RahClient,
  roomId: string,
  signal?: AbortSignal,
): Promise<RoomTaskOverview> {
  const requestOptions = signal === undefined ? undefined : { signal };
  const [recent, active] = await Promise.all([
    client.request("task.list", { limit: 200, roomId }, requestOptions),
    client.request(
      "task.list",
      {
        limit: 500,
        roomId,
        states: [...ACTIVE_ROOM_TASK_STATES],
      },
      requestOptions,
    ),
  ]);
  return roomTaskOverview(recent, active);
}

export async function loadEarlierRoomTaskOverview(
  client: RahClient,
  roomId: string,
  cursor: RoomTaskPageCursor | undefined,
  signal?: AbortSignal,
): Promise<RoomTaskOverview> {
  if (cursor === undefined) return { tasks: [] };
  const requestOptions = signal === undefined ? undefined : { signal };
  const [recent, active] = await Promise.all([
    cursor.recentBeforeTaskNumber === undefined
      ? Promise.resolve({ tasks: [] as Task[] })
      : client.request(
          "task.list",
          {
            beforeTaskNumber: cursor.recentBeforeTaskNumber,
            limit: 200,
            roomId,
          },
          requestOptions,
        ),
    cursor.activeBeforeTaskNumber === undefined
      ? Promise.resolve({ tasks: [] as Task[] })
      : client.request(
          "task.list",
          {
            beforeTaskNumber: cursor.activeBeforeTaskNumber,
            limit: 500,
            roomId,
            states: [...ACTIVE_ROOM_TASK_STATES],
          },
          requestOptions,
        ),
  ]);
  return roomTaskOverview(recent, active);
}

function roomTaskOverview(
  recent: {
    nextBeforeTaskNumber?: number | undefined;
    tasks: readonly Task[];
  },
  active: {
    nextBeforeTaskNumber?: number | undefined;
    tasks: readonly Task[];
  },
): RoomTaskOverview {
  const nextPage: RoomTaskPageCursor = {
    ...(active.nextBeforeTaskNumber === undefined
      ? {}
      : { activeBeforeTaskNumber: active.nextBeforeTaskNumber }),
    ...(recent.nextBeforeTaskNumber === undefined
      ? {}
      : { recentBeforeTaskNumber: recent.nextBeforeTaskNumber }),
  };
  return {
    ...(Object.keys(nextPage).length === 0 ? {} : { nextPage }),
    tasks: mergeRoomTaskPages(recent, active),
  };
}

function roomTaskWindow(
  base: RoomTaskOverview,
  earlierPages: readonly RoomTaskWindowPage[],
): RoomTaskWindow {
  const last = earlierPages.at(-1)?.overview ?? base;
  return {
    base,
    earlierPages: [...earlierPages],
    ...(last.nextPage === undefined ? {} : { nextPage: last.nextPage }),
    tasks: mergeRoomTaskPages(
      base,
      ...earlierPages.map(({ overview }) => overview),
    ),
  };
}
