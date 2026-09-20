import type { Workspace } from "@rah-os/protocol";

const PREFIX = "rah:workspace-switcher:v1";
const MAX_ORDERED_WORKSPACES = 128;
const MAX_LOCATION_LENGTH = 4096;
// Search and Activity have independent rail entries; neither may capture Chat.
const CHAT_SURFACES = new Set(["room", "saved"]);
const GLOBAL_SURFACES = new Set([
  "room",
  "activity",
  "computers",
  "saved",
  "search",
  "settings",
  "tasks",
]);

export function workspacePreferenceKey(
  principalId: string,
  field: "order" | `location:${string}`,
) {
  return `${PREFIX}:${principalId}:${field}`;
}

export function writeWorkspaceOrder(
  storage: Storage,
  principalId: string,
  workspaceIds: readonly string[],
) {
  try {
    storage.setItem(
      workspacePreferenceKey(principalId, "order"),
      JSON.stringify(
        [...new Set(workspaceIds)].slice(0, MAX_ORDERED_WORKSPACES),
      ),
    );
  } catch {
    // Navigation preferences are best effort and never conversation truth.
  }
}

export function readWorkspaceOrder(
  storage: Storage,
  principalId: string,
  workspaces: readonly Workspace[],
) {
  const canonical = workspaces.map(({ workspaceId }) => workspaceId);
  const visible = new Set(canonical);
  let stored: unknown;
  try {
    stored = JSON.parse(
      storage.getItem(workspacePreferenceKey(principalId, "order")) ?? "[]",
    );
  } catch {
    stored = [];
  }
  const known = Array.isArray(stored)
    ? stored.filter(
        (value, index): value is string =>
          typeof value === "string" &&
          visible.has(value) &&
          stored.indexOf(value) === index,
      )
    : [];
  return [
    ...known,
    ...canonical.filter((workspaceId) => !known.includes(workspaceId)),
  ];
}

export function moveWorkspaceOrder(
  current: readonly string[],
  activeId: string,
  overId: string,
) {
  const from = current.indexOf(activeId);
  const to = current.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return [...current];
  const next = [...current];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...current];
  next.splice(to, 0, moved);
  return next;
}

export function rememberWorkspaceLocation(
  storage: Storage,
  principalId: string,
  workspaceId: string,
  search: string,
) {
  const key = workspacePreferenceKey(principalId, `location:${workspaceId}`);
  try {
    if (
      search.length === 0 ||
      search.length > MAX_LOCATION_LENGTH ||
      !search.startsWith("?")
    ) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, search);
    const surface = new URLSearchParams(search).get("surface") ?? "room";
    if (CHAT_SURFACES.has(surface) || surface === "agents") {
      storage.setItem(
        `${key}:${surface === "agents" ? "agents" : "room"}`,
        search,
      );
    }
  } catch {
    // Best effort, matching Raft's guarded localStorage route memory.
  }
}

export function recallWorkspaceSurface(
  storage: Storage,
  principalId: string,
  workspaceId: string,
  surface: "room" | "agents",
): string | undefined {
  try {
    const value = storage.getItem(
      `${workspacePreferenceKey(principalId, `location:${workspaceId}`)}:${surface}`,
    );
    if (!value?.startsWith("?") || value.length > MAX_LOCATION_LENGTH) return;
    const params = new URLSearchParams(value);
    const target = params.get("surface") ?? "room";
    if (surface === "room" ? CHAT_SURFACES.has(target) : target === surface)
      return value;
  } catch {
    /* Navigation preferences are best effort. */
  }
  return undefined;
}

export function resolveWorkspaceLocation(
  storage: Storage,
  principalId: string,
  workspaceId: string,
  workspaceRoomIds: ReadonlySet<string>,
) {
  const key = workspacePreferenceKey(principalId, `location:${workspaceId}`);
  let search: string | null;
  try {
    search = storage.getItem(key);
  } catch {
    return;
  }
  if (
    !search ||
    search.length > MAX_LOCATION_LENGTH ||
    !search.startsWith("?")
  ) {
    try {
      storage.removeItem(key);
    } catch {}
    return;
  }
  const params = new URLSearchParams(search);
  const roomId = params.get("room");
  const surface = params.get("surface");
  const valid = roomId
    ? workspaceRoomIds.has(roomId) &&
      (surface === null || surface === "room" || surface === "activity") &&
      threadMatchesRoom(params.get("thread"), roomId)
    : surface !== null && GLOBAL_SURFACES.has(surface);
  if (valid) return search;
  try {
    storage.removeItem(key);
  } catch {}
  return;
}

function threadMatchesRoom(thread: string | null, roomId: string) {
  if (thread === null) return true;
  const separator = thread.indexOf(":");
  return separator > 0 && thread.slice(0, separator) === roomId;
}
