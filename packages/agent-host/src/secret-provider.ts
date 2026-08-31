import { constants } from "node:fs";
import { open } from "node:fs/promises";

const MAX_SECRET_BYTES = 65_536;

export type FileSecretReference = Readonly<{
  path: string;
  source: "file";
}>;

export interface SecretProvider {
  load(reference: FileSecretReference): Promise<string>;
}

/** Temporary owner-private file backend; Keychain can implement the same port. */
export class FileSecretProvider implements SecretProvider {
  async load(reference: FileSecretReference): Promise<string> {
    if (reference.source !== "file") {
      throw new Error(`unsupported secret source: ${String(reference.source)}`);
    }
    let file;
    try {
      file = await open(
        reference.path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const metadata = await file.stat();
      if (
        !metadata.isFile() ||
        (metadata.mode & 0o077) !== 0 ||
        (typeof process.getuid === "function" &&
          metadata.uid !== process.getuid())
      ) {
        throw new Error(
          `Secret file must be an owner-private regular file: ${reference.path}`,
        );
      }
      if (metadata.size > MAX_SECRET_BYTES) {
        throw new Error("Secret file exceeds the safe byte limit");
      }
      const contents = Buffer.allocUnsafe(MAX_SECRET_BYTES + 1);
      let bytesRead = 0;
      while (bytesRead < contents.byteLength) {
        const result = await file.read(
          contents,
          bytesRead,
          contents.byteLength - bytesRead,
          null,
        );
        if (result.bytesRead === 0) break;
        bytesRead += result.bytesRead;
      }
      if (bytesRead > MAX_SECRET_BYTES) {
        throw new Error("Secret file exceeds the safe byte limit");
      }
      const secret = contents.subarray(0, bytesRead).toString("utf8").trim();
      if (secret.length === 0) throw new Error("Secret file is empty");
      return secret;
    } catch (error) {
      if (hasErrorCode(error, "ELOOP")) {
        throw new Error(
          `Secret file must be an owner-private regular file: ${reference.path}`,
        );
      }
      throw error;
    } finally {
      await file?.close();
    }
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
