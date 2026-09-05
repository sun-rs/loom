import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type {
  RoomBootstrapReadResponse,
  RoomOlderMessagesReadResponse,
  RoomReadHttpEnvelope,
} from "@rah/runtime-protocol";

import { startRahDaemon } from "./http-server";
import { DeviceAuthManager } from "./device-auth";
import { RuntimeEngine } from "./runtime-engine";
import { WorkbenchNoticePreferencesStore } from "./workbench-notice-preferences";
import { RoomActorResolver } from "./room/room-actor";
import { RoomLedger } from "./room/room-ledger";
import {
  createRoomApplicationRuntime,
  resolveRoomStorageLayout,
} from "./room/room-runtime";

const ROOM_HTTP_BYTE_SENTINEL = `latest 😀 message\nwith\ttab, quote " and slash \\`;

async function freePort(): Promise<number> {
  const server = createServer();
  return await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a free port"));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function createIsolatedRuntimeEngine(dataRoot: string): RuntimeEngine {
  const previousRahHome = process.env.RAH_HOME;
  process.env.RAH_HOME = path.join(dataRoot, "runtime");
  try {
    return new RuntimeEngine([]);
  } finally {
    if (previousRahHome === undefined) delete process.env.RAH_HOME;
    else process.env.RAH_HOME = previousRahHome;
  }
}

function createIsolatedNoticePreferences(
  dataRoot: string,
): WorkbenchNoticePreferencesStore {
  return new WorkbenchNoticePreferencesStore(path.join(dataRoot, "notices"));
}

function seedRoom(roomRoot: string): string {
  const layout = resolveRoomStorageLayout(roomRoot);
  const ledger = new RoomLedger(layout.databasePath);
  try {
    const actor = new RoomActorResolver(ledger).resolve({ kind: "local" });
    ledger.createRoom(actor.principalId, {
      roomId: "room-http",
      workspaceKey: "workspace-local",
      kind: "channel",
      slug: "http",
      name: "HTTP Room",
      visibility: "private",
      idempotencyKey: "create-http-room",
    });
    ledger.postMessage(actor.principalId, {
      roomId: "room-http",
      body: "older message",
      idempotencyKey: "older-message",
    });
    ledger.postMessage(actor.principalId, {
      roomId: "room-http",
      body: ROOM_HTTP_BYTE_SENTINEL,
      idempotencyKey: "latest-message",
    });
    return actor.principalId;
  } finally {
    ledger.close();
  }
}

async function postRoom(args: {
  port: number;
  path: string;
  body?: unknown;
  rawBody?: string;
}): Promise<{ response: Response; bytes: Buffer; envelope: RoomReadHttpEnvelope }> {
  const response = await fetch(`http://127.0.0.1:${args.port}${args.path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: `http://127.0.0.1:${args.port}`,
      "x-rah-client": "web",
    },
    body: args.rawBody ?? JSON.stringify(args.body),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    response,
    bytes,
    envelope: JSON.parse(bytes.toString("utf8")) as RoomReadHttpEnvelope,
  };
}

test("production Room HTTP routes authenticate once and preserve the exact wire envelope", async () => {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), "rah-room-http-"));
  const roomRoot = path.join(dataRoot, "room");
  seedRoom(roomRoot);
  const auth = new DeviceAuthManager({ rootDir: path.join(dataRoot, "auth") });
  const authenticate = auth.authenticate.bind(auth);
  let authenticationCalls = 0;
  auth.authenticate = (request) => {
    authenticationCalls += 1;
    return authenticate(request);
  };
  const daemon = await startRahDaemon({
    host: "127.0.0.1",
    port: await freePort(),
    roomRoot,
    auth,
    engine: createIsolatedRuntimeEngine(dataRoot),
    createNoticePreferences: () => createIsolatedNoticePreferences(dataRoot),
  });
  try {
    await fetch(`http://127.0.0.1:${daemon.port}/`);
    assert.equal(authenticationCalls, 0);

    const bootstrap = await postRoom({
      port: daemon.port,
      path: "/api/room/v1/bootstrap",
      body: { roomId: "room-http", limit: 1 },
    });
    assert.equal(bootstrap.response.status, 200);
    assert.equal(authenticationCalls, 1);
    assert.equal(bootstrap.response.headers.get("cache-control"), "no-store");
    assert.equal(
      bootstrap.response.headers.get("content-length"),
      String(bootstrap.bytes.byteLength),
    );
    assert.equal(bootstrap.envelope.ok, true);
    if (
      !bootstrap.envelope.ok ||
      (bootstrap.envelope.data as { mode?: unknown }).mode !== "latest_bootstrap"
    ) {
      throw new Error("expected Room bootstrap envelope");
    }
    const bootstrapData = bootstrap.envelope.data as RoomBootstrapReadResponse;
    assert.equal(bootstrapData.snapshot.room.roomId, "room-http");
    assert.equal(bootstrapData.recentMessages[0]?.body, ROOM_HTTP_BYTE_SENTINEL);
    assert.ok(bootstrapData.olderMessagesCursor);

    const events = await postRoom({
      port: daemon.port,
      path: "/api/room/v1/events",
      body: {
        roomId: "room-http",
        cursor: bootstrapData.eventCursor,
      },
    });
    assert.equal(events.response.status, 200);
    assert.equal(events.envelope.ok, true);

    const older = await postRoom({
      port: daemon.port,
      path: "/api/room/v1/older-messages",
      body: {
        roomId: "room-http",
        cursor: bootstrapData.olderMessagesCursor,
      },
    });
    assert.equal(older.response.status, 200);
    assert.equal(older.envelope.ok, true);
    if (
      !older.envelope.ok ||
      (older.envelope.data as { mode?: unknown }).mode !== "older_messages"
    ) {
      throw new Error("expected older Room messages envelope");
    }
    const olderData = older.envelope.data as RoomOlderMessagesReadResponse;
    assert.equal(olderData.messages[0]?.body, "older message");

    const inbox = await postRoom({
      port: daemon.port,
      path: "/api/room/v1/inbox",
      body: {},
    });
    assert.equal(inbox.response.status, 200);
    assert.equal(inbox.envelope.ok, true);

    const injected = await postRoom({
      port: daemon.port,
      path: "/api/room/v1/bootstrap",
      body: { roomId: "room-http", actorId: "agent-injected" },
    });
    assert.equal(injected.response.status, 400);
    assert.deepEqual(injected.envelope.ok, false);
    assert.equal(authenticationCalls, 5);
  } finally {
    await daemon.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("Room HTTP routes return typed failures for malformed, oversized, and unauthenticated input", async () => {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), "rah-room-http-errors-"));
  const roomRoot = path.join(dataRoot, "room");
  seedRoom(roomRoot);
  const daemon = await startRahDaemon({
    host: "127.0.0.1",
    port: await freePort(),
    roomRoot,
    auth: false,
    engine: createIsolatedRuntimeEngine(dataRoot),
    createNoticePreferences: () => createIsolatedNoticePreferences(dataRoot),
  });
  try {
    const unauthenticated = await postRoom({
      port: daemon.port,
      path: "/api/room/v1/bootstrap",
      body: { roomId: "room-http" },
    });
    assert.equal(unauthenticated.response.status, 401);
    assert.deepEqual(unauthenticated.envelope, {
      ok: false,
      error: {
        code: "unauthenticated",
        message: "Room access requires an authenticated device",
      },
    });
  } finally {
    await daemon.close();
  }

  const authenticated = await startRahDaemon({
    host: "127.0.0.1",
    port: await freePort(),
    roomRoot,
    auth: new DeviceAuthManager({ rootDir: path.join(dataRoot, "auth") }),
    engine: createIsolatedRuntimeEngine(dataRoot),
    createNoticePreferences: () => createIsolatedNoticePreferences(dataRoot),
  });
  try {
    const malformed = await postRoom({
      port: authenticated.port,
      path: "/api/room/v1/bootstrap",
      rawBody: "not-json",
    });
    assert.equal(malformed.response.status, 400);
    assert.equal(malformed.envelope.ok, false);
    if (malformed.envelope.ok) throw new Error("expected malformed failure");
    assert.equal(malformed.envelope.error.code, "invalid_argument");

    const oversized = await postRoom({
      port: authenticated.port,
      path: "/api/room/v1/bootstrap",
      rawBody: JSON.stringify({ roomId: "room-http", padding: "x".repeat(70_000) }),
    });
    assert.equal(oversized.response.status, 413);
    assert.equal(oversized.envelope.ok, false);
    if (oversized.envelope.ok) throw new Error("expected oversized failure");
    assert.equal(oversized.envelope.error.code, "resource_exhausted");
  } finally {
    await authenticated.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("Room HTTP authentication and request-policy failures stay typed and redact internals", async () => {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), "rah-room-http-auth-error-"));
  const roomRoot = path.join(dataRoot, "room");
  seedRoom(roomRoot);
  const auth = new DeviceAuthManager({ rootDir: path.join(dataRoot, "auth") });
  const privateFailure = "/private/secret/devices.json write failed";
  auth.authenticate = () => {
    throw new Error(privateFailure);
  };
  const daemon = await startRahDaemon({
    host: "127.0.0.1",
    port: await freePort(),
    roomRoot,
    auth,
    engine: createIsolatedRuntimeEngine(dataRoot),
    createNoticePreferences: () => createIsolatedNoticePreferences(dataRoot),
  });
  try {
    const authenticationFailure = await postRoom({
      port: daemon.port,
      path: "/api/room/v1/bootstrap",
      body: { roomId: "room-http" },
    });
    assert.equal(authenticationFailure.response.status, 500);
    assert.deepEqual(authenticationFailure.envelope, {
      ok: false,
      error: {
        code: "internal",
        message: "Internal Room read failure",
      },
    });
    assert.doesNotMatch(authenticationFailure.bytes.toString("utf8"), /private\/secret/u);

    const rejectedResponse = await fetch(
      `http://127.0.0.1:${daemon.port}/api/room/v1/bootstrap`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://untrusted.example",
          "x-rah-client": "web",
        },
        body: JSON.stringify({ roomId: "room-http" }),
      },
    );
    assert.equal(rejectedResponse.status, 403);
    assert.deepEqual(await rejectedResponse.json(), {
      ok: false,
      error: {
        code: "forbidden",
        message: "Room access is forbidden",
      },
    });
  } finally {
    await daemon.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("notification preference flush failure still releases the Room application owner", async () => {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), "rah-room-http-flush-"));
  const roomRoot = path.join(dataRoot, "room");
  const noticePreferences = createIsolatedNoticePreferences(dataRoot);
  noticePreferences.flush = async () => {
    throw new Error("injected notice preference flush failure");
  };
  const daemon = await startRahDaemon({
    host: "127.0.0.1",
    port: await freePort(),
    roomRoot,
    auth: false,
    engine: createIsolatedRuntimeEngine(dataRoot),
    createNoticePreferences: () => noticePreferences,
  });

  try {
    await assert.rejects(daemon.close(), /RAH shutdown failed/u);
    const recoveredRuntime = await createRoomApplicationRuntime({ roomRoot });
    await recoveredRuntime.close();
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("failed daemon listen releases the Room application owner", async () => {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), "rah-room-http-listen-"));
  const roomRoot = path.join(dataRoot, "room");
  const blocker = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    blocker.listen(0, "127.0.0.1", () => {
      const address = blocker.address();
      if (!address || typeof address === "string") reject(new Error("missing blocker port"));
      else resolve(address.port);
    });
  });
  try {
    await assert.rejects(
      startRahDaemon({
        host: "127.0.0.1",
        port,
        roomRoot,
        auth: false,
        engine: createIsolatedRuntimeEngine(dataRoot),
        createNoticePreferences: () => createIsolatedNoticePreferences(dataRoot),
      }),
      /EADDRINUSE/u,
    );
    const runtime = await createRoomApplicationRuntime({ roomRoot });
    await runtime.close();
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("failed daemon setup releases both the engine and Room application owner", async () => {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), "rah-room-http-setup-"));
  const roomRoot = path.join(dataRoot, "room");
  const roomRuntime = await createRoomApplicationRuntime({ roomRoot });
  const engine = createIsolatedRuntimeEngine(dataRoot);
  const originalShutdown = engine.shutdown.bind(engine);
  let engineShutdownCalls = 0;
  engine.shutdown = async () => {
    engineShutdownCalls += 1;
    await originalShutdown();
  };

  try {
    await assert.rejects(
      startRahDaemon({
        engine,
        roomRuntime,
        auth: false,
        createNoticePreferences() {
          throw new Error("simulated notice preferences setup failure");
        },
      }),
      /simulated notice preferences setup failure/u,
    );
    assert.equal(engineShutdownCalls, 1);

    const replacement = await createRoomApplicationRuntime({ roomRoot });
    await replacement.close();
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("failed WebSocket attachment releases both startup owners", async () => {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), "rah-room-http-websocket-"));
  const roomRoot = path.join(dataRoot, "room");
  const roomRuntime = await createRoomApplicationRuntime({ roomRoot });
  const engine = createIsolatedRuntimeEngine(dataRoot);
  const originalShutdown = engine.shutdown.bind(engine);
  let engineShutdownCalls = 0;
  engine.shutdown = async () => {
    engineShutdownCalls += 1;
    await originalShutdown();
  };

  try {
    await assert.rejects(
      startRahDaemon({
        engine,
        roomRuntime,
        auth: false,
        createNoticePreferences: () => createIsolatedNoticePreferences(dataRoot),
        attachWebSockets() {
          throw new Error("simulated WebSocket attachment failure");
        },
      }),
      /simulated WebSocket attachment failure/u,
    );
    assert.equal(engineShutdownCalls, 1);

    const replacement = await createRoomApplicationRuntime({ roomRoot });
    await replacement.close();
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("failed Room owner acquisition releases an engine transferred to daemon startup", async () => {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), "rah-room-http-owner-failure-"));
  const roomRoot = path.join(dataRoot, "room");
  const activeRoomRuntime = await createRoomApplicationRuntime({ roomRoot });
  const engine = createIsolatedRuntimeEngine(dataRoot);
  const originalShutdown = engine.shutdown.bind(engine);
  let engineShutdownCalls = 0;
  engine.shutdown = async () => {
    engineShutdownCalls += 1;
    await originalShutdown();
  };

  try {
    await assert.rejects(
      startRahDaemon({ engine, roomRoot, auth: false }),
      /another Room application owner is active/u,
    );
    assert.equal(engineShutdownCalls, 1);
  } finally {
    await activeRoomRuntime.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
