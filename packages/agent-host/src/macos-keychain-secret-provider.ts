import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

import {
  FileSecretProvider,
  type FileSecretReference,
  type SecretProvider,
} from "./secret-provider.ts";

const MAX_SECRET_BYTES = 65_536;
const MAX_SECURITY_OUTPUT_BYTES = MAX_SECRET_BYTES + 2;

export type MacOSKeychainSecretReference = Readonly<{
  account: string;
  service: string;
  source: "macos-keychain";
}>;

export type ComputerSecretReference =
  FileSecretReference | MacOSKeychainSecretReference;

export interface ComputerSecretProvider {
  load(reference: ComputerSecretReference): Promise<string>;
}

export interface MacOSKeychainSecretLoader {
  load(reference: MacOSKeychainSecretReference): Promise<string>;
}

export type MacOSKeychainSecretProviderOptions = Readonly<{
  platform?: NodeJS.Platform;
  spawn?: (
    executablePath: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess;
  timeoutMs?: number;
}>;

/**
 * Loads one generic-password value through the fixed macOS security binary.
 * The secret is collected only from bounded stdout and is never included in
 * argv, environment, diagnostics, or an error message.
 */
export class MacOSKeychainSecretProvider implements MacOSKeychainSecretLoader {
  readonly #platform: NodeJS.Platform;
  readonly #spawn: NonNullable<MacOSKeychainSecretProviderOptions["spawn"]>;
  readonly #timeoutMs: number;

  constructor(options: MacOSKeychainSecretProviderOptions = {}) {
    this.#platform = options.platform ?? process.platform;
    this.#spawn = options.spawn ?? spawn;
    this.#timeoutMs = positiveInteger(options.timeoutMs ?? 5_000, "timeoutMs");
  }

  async load(reference: MacOSKeychainSecretReference): Promise<string> {
    if (this.#platform !== "darwin") {
      throw new Error("macOS Keychain secret loading requires macOS");
    }
    const normalized = normalizeReference(reference);
    const child = this.#spawn(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-w",
        "-s",
        normalized.service,
        "-a",
        normalized.account,
      ],
      {
        detached: false,
        env: {},
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    if (child.stdout === null || child.stderr === null) {
      child.kill("SIGKILL");
      throw new Error("macOS Keychain lookup did not create bounded pipes");
    }
    const stdout = child.stdout;
    child.stderr.resume();
    return await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let byteLength = 0;
      let settled = false;
      const finish = (error?: Error, value?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeAllListeners("error");
        child.removeAllListeners("close");
        stdout.removeAllListeners("data");
        if (error !== undefined) reject(error);
        else resolve(value!);
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new Error("macOS Keychain lookup timed out"));
      }, this.#timeoutMs);
      stdout.on("data", (value: Buffer | string) => {
        if (settled) return;
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        byteLength += chunk.byteLength;
        if (byteLength > MAX_SECURITY_OUTPUT_BYTES) {
          child.kill("SIGKILL");
          finish(new Error("Keychain secret exceeds the safe byte limit"));
          return;
        }
        chunks.push(chunk);
      });
      child.once("error", () => {
        finish(new Error("macOS Keychain lookup could not be started"));
      });
      child.once("close", (code, signal) => {
        if (settled) return;
        if (code !== 0) {
          finish(
            new Error(
              signal === null
                ? "macOS Keychain item is unavailable"
                : "macOS Keychain lookup was interrupted",
            ),
          );
          return;
        }
        let decoded: string;
        try {
          decoded = new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks, byteLength),
          );
        } catch {
          finish(new Error("Keychain secret is not valid UTF-8"));
          return;
        }
        const secret = decoded.endsWith("\n")
          ? decoded.slice(0, -1).replace(/\r$/u, "")
          : decoded;
        if (Buffer.byteLength(secret, "utf8") > MAX_SECRET_BYTES) {
          finish(new Error("Keychain secret exceeds the safe byte limit"));
          return;
        }
        if (secret.length === 0 || secret.includes("\0")) {
          finish(new Error("Keychain secret is empty or invalid"));
          return;
        }
        finish(undefined, secret);
      });
    });
  }
}

export type SystemComputerSecretProviderOptions = Readonly<{
  file?: SecretProvider;
  keychain?: MacOSKeychainSecretLoader;
}>;

/** Routes an explicit secret source; it never falls back across stores. */
export class SystemComputerSecretProvider implements ComputerSecretProvider {
  readonly #file: SecretProvider;
  readonly #keychain: MacOSKeychainSecretLoader;

  constructor(options: SystemComputerSecretProviderOptions = {}) {
    this.#file = options.file ?? new FileSecretProvider();
    this.#keychain = options.keychain ?? new MacOSKeychainSecretProvider();
  }

  async load(reference: ComputerSecretReference): Promise<string> {
    if (reference.source === "file") {
      return await this.#file.load(reference);
    }
    if (reference.source === "macos-keychain") {
      return await this.#keychain.load(reference);
    }
    throw new Error("unsupported Computer secret source");
  }
}

function normalizeReference(
  value: MacOSKeychainSecretReference,
): MacOSKeychainSecretReference {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.keys(value).sort().join(",") !== "account,service,source" ||
    value.source !== "macos-keychain"
  ) {
    throw new Error("macOS Keychain secret reference is invalid");
  }
  return Object.freeze({
    account: identifier(value.account, "Keychain account"),
    service: identifier(value.service, "Keychain service"),
    source: "macos-keychain",
  });
}

function identifier(value: string, name: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}
