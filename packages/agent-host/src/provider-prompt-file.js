import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { isAbsolute } from "node:path";

/** Transport only: prompt composition remains daemon-owned. */
export function readProviderPromptFile(path) {
  if (!isAbsolute(path))
    throw new Error("Provider prompt path must be absolute");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    )
      throw new Error("Provider prompt file must be owner-private");
    const text = readFileSync(fd, "utf8");
    if (!text.trim()) throw new Error("Provider prompt file is empty");
    return text;
  } finally {
    closeSync(fd);
  }
}
