import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import { z } from "zod";

const MAXIMUM_STATE_BYTES = 256 * 1_024;
const MAXIMUM_DEVICES = 64;
const MAXIMUM_INVITES = 16;
const MAXIMUM_SESSIONS = 256;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const StoredDeviceSchema = z
  .object({
    createdAt: z.number().int().nonnegative(),
    deviceId: z.string().uuid(),
    displayName: z.string().min(1).max(80),
    lastSeenAt: z.number().int().nonnegative(),
    revokedAt: z.number().int().nonnegative().nullable(),
  })
  .strict();

const StoredInviteSchema = z
  .object({
    codeDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    inviteId: z.string().uuid(),
    usedAt: z.number().int().nonnegative().nullable(),
  })
  .strict();

const StoredSessionSchema = z
  .object({
    createdAt: z.number().int().nonnegative(),
    deviceId: z.string().uuid(),
    expiresAt: z.number().int().nonnegative(),
    lastSeenAt: z.number().int().nonnegative(),
    sessionId: z.string().uuid(),
    tokenDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

const LanWorkbenchAccessStateSchema = z
  .object({
    devices: z.array(StoredDeviceSchema).max(MAXIMUM_DEVICES),
    invites: z.array(StoredInviteSchema).max(MAXIMUM_INVITES),
    revision: z.number().int().nonnegative(),
    schemaVersion: z.literal(1),
    sessions: z.array(StoredSessionSchema).max(MAXIMUM_SESSIONS),
  })
  .strict();

type StoredDevice = z.infer<typeof StoredDeviceSchema>;
type LanWorkbenchAccessState = z.infer<typeof LanWorkbenchAccessStateSchema>;

export type LanWorkbenchDevice = {
  createdAt: string;
  deviceId: string;
  displayName: string;
  lastSeenAt: string;
  revokedAt: string | null;
};

export type LanWorkbenchPairingCode = {
  code: string;
  expiresAt: string;
  inviteId: string;
};

export class LanWorkbenchAccessStore {
  readonly #clock: () => number;
  readonly #path: string;
  readonly #sessionTtlMs: number;
  #state: LanWorkbenchAccessState;

  constructor(input: {
    clock?: () => number;
    path: string;
    sessionTtlMs?: number;
  }) {
    if (!isAbsolute(input.path)) {
      throw new Error("LAN access state path must be absolute");
    }
    this.#clock = input.clock ?? Date.now;
    this.#path = input.path;
    this.#sessionTtlMs = input.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    if (!Number.isSafeInteger(this.#sessionTtlMs) || this.#sessionTtlMs < 1) {
      throw new Error("LAN browser session TTL must be a positive integer");
    }
    assertOwnerPrivateDirectory(dirname(this.#path));
    this.#state = existsSync(this.#path)
      ? readState(this.#path)
      : {
          devices: [],
          invites: [],
          revision: 0,
          schemaVersion: 1,
          sessions: [],
        };
    if (!existsSync(this.#path)) this.#persist();
  }

  issuePairingCode(input: { ttlMs: number }): LanWorkbenchPairingCode {
    if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1) {
      throw new Error("LAN pairing TTL must be a positive integer");
    }
    const now = this.#now();
    this.#pruneExpired(now);
    if (this.#state.invites.length >= MAXIMUM_INVITES) {
      throw new Error("too many active LAN pairing codes");
    }
    const code = pairingCode();
    const invite = {
      codeDigest: credentialDigest("pairing", normalizedPairingCode(code)),
      createdAt: now,
      expiresAt: now + input.ttlMs,
      inviteId: randomUUID(),
      usedAt: null,
    };
    this.#state.invites.push(invite);
    this.#persist();
    return {
      code,
      expiresAt: new Date(invite.expiresAt).toISOString(),
      inviteId: invite.inviteId,
    };
  }

  exchangePairingCode(
    code: string,
    displayName: string,
  ): { device: LanWorkbenchDevice; sessionToken: string } | null {
    const normalizedCode = normalizedPairingCode(code);
    const normalizedName = normalizeDisplayName(displayName);
    const now = this.#now();
    this.#pruneExpired(now);
    const suppliedDigest = credentialDigest("pairing", normalizedCode);
    const invite = this.#state.invites.find(
      (candidate) =>
        candidate.usedAt === null &&
        candidate.expiresAt >= now &&
        secureEqual(candidate.codeDigest, suppliedDigest),
    );
    if (invite === undefined) return null;
    if (this.#state.devices.length >= MAXIMUM_DEVICES) {
      throw new Error("LAN device limit reached");
    }
    if (this.#state.sessions.length >= MAXIMUM_SESSIONS) {
      throw new Error("LAN browser session limit reached");
    }
    invite.usedAt = now;
    const device: StoredDevice = {
      createdAt: now,
      deviceId: randomUUID(),
      displayName: normalizedName,
      lastSeenAt: now,
      revokedAt: null,
    };
    const sessionToken = randomBytes(32).toString("base64url");
    this.#state.devices.push(device);
    this.#state.sessions.push({
      createdAt: now,
      deviceId: device.deviceId,
      expiresAt: now + this.#sessionTtlMs,
      lastSeenAt: now,
      sessionId: randomUUID(),
      tokenDigest: credentialDigest("session", sessionToken),
    });
    this.#persist();
    return { device: publicDevice(device), sessionToken };
  }

  authenticateSession(token: string): LanWorkbenchDevice | null {
    if (token.length === 0 || token.length > 256) return null;
    const now = this.#now();
    this.#pruneExpired(now);
    const suppliedDigest = credentialDigest("session", token);
    const session = this.#state.sessions.find((candidate) =>
      secureEqual(candidate.tokenDigest, suppliedDigest),
    );
    if (session === undefined || session.expiresAt < now) return null;
    const device = this.#state.devices.find(
      (candidate) =>
        candidate.deviceId === session.deviceId && candidate.revokedAt === null,
    );
    if (device === undefined) return null;
    if (now - session.lastSeenAt >= 60_000) {
      session.lastSeenAt = now;
      device.lastSeenAt = now;
      this.#persist();
    }
    return publicDevice(device);
  }

  listDevices(): LanWorkbenchDevice[] {
    return this.#state.devices
      .map(publicDevice)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  activeDeviceCount(): number {
    return this.#state.devices.filter(({ revokedAt }) => revokedAt === null)
      .length;
  }

  revokeDevice(deviceId: string): boolean {
    const device = this.#state.devices.find(
      (candidate) => candidate.deviceId === deviceId,
    );
    if (device === undefined || device.revokedAt !== null) return false;
    device.revokedAt = this.#now();
    this.#state.sessions = this.#state.sessions.filter(
      (session) => session.deviceId !== deviceId,
    );
    this.#persist();
    return true;
  }

  #now(): number {
    const value = this.#clock();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("LAN access clock returned an invalid timestamp");
    }
    return value;
  }

  #pruneExpired(now: number): void {
    this.#state.invites = this.#state.invites.filter(
      (invite) => invite.usedAt === null && invite.expiresAt >= now,
    );
    this.#state.sessions = this.#state.sessions.filter(
      (session) => session.expiresAt >= now,
    );
  }

  #persist(): void {
    this.#state.revision += 1;
    this.#state = LanWorkbenchAccessStateSchema.parse(this.#state);
    writeState(this.#path, this.#state);
  }
}

function normalizeDisplayName(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 80 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new Error("LAN device name must be 1 to 80 printable characters");
  }
  return normalized;
}

function normalizedPairingCode(value: string): string {
  const normalized = value.toUpperCase().replaceAll(/[^A-Z2-9]/gu, "");
  return normalized.length === 12 ? normalized : "invalid";
}

function pairingCode(): string {
  const bytes = randomBytes(12);
  const characters = Array.from(
    bytes,
    (byte) => PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length],
  ).join("");
  return `${characters.slice(0, 4)}-${characters.slice(4, 8)}-${characters.slice(8)}`;
}

function credentialDigest(kind: "pairing" | "session", value: string): string {
  return createHash("sha256")
    .update(`rah-lan-${kind}-v1\0`, "utf8")
    .update(value, "utf8")
    .digest("hex");
}

function secureEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function publicDevice(device: StoredDevice): LanWorkbenchDevice {
  return {
    createdAt: new Date(device.createdAt).toISOString(),
    deviceId: device.deviceId,
    displayName: device.displayName,
    lastSeenAt: new Date(device.lastSeenAt).toISOString(),
    revokedAt:
      device.revokedAt === null
        ? null
        : new Date(device.revokedAt).toISOString(),
  };
}

function readState(path: string): LanWorkbenchAccessState {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("LAN access state must be an owner-private regular file");
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("LAN access state must be owner-private");
  }
  if (metadata.size > MAXIMUM_STATE_BYTES) {
    throw new Error("LAN access state exceeds its safe byte limit");
  }
  return LanWorkbenchAccessStateSchema.parse(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
}

function writeState(path: string, state: LanWorkbenchAccessState): void {
  const directory = dirname(path);
  const temporaryPath = join(directory, `.lan-access-${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
    const directoryDescriptor = openSync(directory, "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}

function assertOwnerPrivateDirectory(path: string): void {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("LAN access state parent must be a real directory");
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("LAN access state parent must be owner-private");
  }
}
