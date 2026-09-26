import {
  checkAttachedDirectory,
  reservedChannelDirectories,
} from "@rah-os/agent-host";

/**
 * Owner 2026-09-26: Host facts about a Human-attached Channel directory,
 * checked when the Channel is created. The platform only validates; it never
 * creates, moves or deletes an attached directory. The rules are the shared
 * Host check (`checkAttachedDirectory`), which the Host repeats before every
 * refresh, launch, evidence capture and browse (review 2026-09-26 P1-1).
 */
export function createChannelAttachedDirectoryValidator(input: {
  stateDirectory: string;
  channelWorkspaceRoot: string;
}): (paths: readonly string[]) => void {
  const reserved = reservedChannelDirectories(input);
  return (paths) => {
    for (const path of paths) checkAttachedDirectory(path, reserved);
  };
}
