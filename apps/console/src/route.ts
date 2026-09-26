/** Hash routes of the console (pure; no DOM). Throwaway: deleted in phase 4. */
export type ConsoleRoute =
  | { kind: "channels" }
  | { kind: "channel"; roomId: string }
  | { kind: "direct"; roomId: string }
  | { kind: "roles" }
  | { kind: "usage" }
  | { kind: "settings" }
  | { kind: "invalid"; hash: string };

export function parseRoute(rawHash: string): ConsoleRoute {
  const hash = rawHash.replace(/^#/u, "");
  const room = /^\/(channel|direct)\/(.+)$/u.exec(hash);
  if (room !== null) {
    try {
      const roomId = decodeURIComponent(room[2]!);
      return room[1] === "channel"
        ? { kind: "channel", roomId }
        : { kind: "direct", roomId };
    } catch {
      return { kind: "invalid", hash };
    }
  }
  if (hash === "/roles") return { kind: "roles" };
  if (hash === "/usage") return { kind: "usage" };
  if (hash === "/settings") return { kind: "settings" };
  return { kind: "channels" };
}
