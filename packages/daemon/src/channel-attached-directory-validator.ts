import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Owner 2026-09-26: Host facts about a Human-attached Channel directory,
 * checked once when the Channel is created. The platform only validates; it
 * never creates, moves or deletes an attached directory. A path must exist,
 * be a directory, already be canonical (no symlink or relative part: the
 * stored path is exactly what every CLI receives), and must not overlap Loom
 * data or the channel home root in either direction.
 */
export function createChannelAttachedDirectoryValidator(input: {
  stateDirectory: string;
  channelWorkspaceRoot: string;
}): (paths: readonly string[]) => void {
  const reserved = [
    { path: canonicalOrResolved(input.stateDirectory), label: "Loom data" },
    {
      path: canonicalOrResolved(input.channelWorkspaceRoot),
      label: "the channel home root",
    },
  ];
  return (paths) => {
    for (const path of paths) {
      if (!isAbsolute(path))
        throw new Error(`${path} is not an absolute directory path`);
      let canonical: string;
      try {
        canonical = realpathSync(path);
      } catch {
        throw new Error(`${path} does not exist`);
      }
      if (!statSync(canonical).isDirectory())
        throw new Error(`${path} is not a directory`);
      if (canonical !== path)
        throw new Error(`${path} is not canonical; use ${canonical}`);
      for (const { path: root, label } of reserved)
        if (overlaps(canonical, root))
          throw new Error(
            label === "Loom data"
              ? `${path} overlaps Loom data (${root})`
              : `${path} overlaps the channel home root (${root})`,
          );
    }
  };
}

function canonicalOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function overlaps(a: string, b: string): boolean {
  return within(a, b) || within(b, a);
}

function within(child: string, parent: string): boolean {
  const path = relative(parent, child);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}
