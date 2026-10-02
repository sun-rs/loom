import { ChannelAttachedDirectoriesSchema } from "@rah-os/protocol";

export function parseChannelDirectories(text: string): string[] {
  return ChannelAttachedDirectoriesSchema.parse(
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}
