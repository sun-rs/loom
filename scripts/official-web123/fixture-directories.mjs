import { basename, isAbsolute } from "node:path";
// Only platform-created primary homes listed by this temporary Core. Attached
// directories and unverified paths are never fixture-cleanup targets.
export function fixtureDirectories(rooms) {
  return [
    ...new Set(
      rooms.flatMap((room) => {
        const path = room.channelWorkspace?.primaryDirectory;
        return typeof path === "string" &&
          isAbsolute(path) &&
          basename(path) === room.roomId
          ? [path]
          : [];
      }),
    ),
  ];
}
