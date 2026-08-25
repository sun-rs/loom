import { lstat, readFile } from "node:fs/promises";

import type { HostCredentialReference } from "./config.ts";

export interface SecretProvider {
  load(reference: HostCredentialReference): Promise<string>;
}

export class FileSecretProvider implements SecretProvider {
  async load(reference: HostCredentialReference): Promise<string> {
    if (reference.source !== "file") {
      throw new Error(`unsupported secret source: ${String(reference.source)}`);
    }
    const metadata = await lstat(reference.path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" &&
        metadata.uid !== process.getuid())
    ) {
      throw new Error(
        `Host credential file must be an owner-private regular file: ${reference.path}`,
      );
    }
    const secret = (await readFile(reference.path, "utf8")).trim();
    if (secret.length === 0) throw new Error("Host credential is empty");
    return secret;
  }
}
