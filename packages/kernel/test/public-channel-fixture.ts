import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RoomKernel, createHumanApplicationPort } from "../src/index.ts";

export function publicChannelFixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-public-join-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({
    databasePath,
    now: () => new Date("2026-09-07T00:00:00Z"),
  });
  kernel.initialize();
  const db = new DatabaseSync(databasePath);
  const people = Object.fromEntries(
    ["owner", "reader", "other", "outsider", "agent"].map((handle) => {
      const p = kernel.provisionPrincipal({
        handle,
        kind: handle === "agent" ? "agent" : "human",
      });
      return [
        handle,
        { ...p, actor: kernel.authenticateAccessToken(p.accessToken) },
      ];
    }),
  );
  const { owner, reader, other, agent } = people;
  const workspace = kernel.createWorkspace(owner!.actor, {
    name: "Public test",
    slug: "public-test",
    idempotencyKey: "workspace",
  });
  const seq = (roomId: string) =>
    Number(
      db
        .prepare("SELECT next_seq-1 AS seq FROM rooms WHERE room_id=?")
        .get(roomId)!.seq,
    );
  for (const person of [reader!, other!, agent!])
    kernel.addRoomMember(owner!.actor, {
      roomId: workspace.controlRoom.roomId,
      basedOnRoomSeq: seq(workspace.controlRoom.roomId),
      idempotencyKey: "enroll-" + person.principal.handle,
      principalId: person.principal.principalId,
      role: "member",
    });
  const channel = (
    name: string,
    visibility: "public" | "private" = "public",
  ) => {
    const room = kernel.createWorkspaceRoom(owner!.actor, {
      workspaceId: workspace.workspace.workspaceId,
      basedOnControlRoomSeq: seq(workspace.controlRoom.roomId),
      idempotencyKey: "create-" + name,
      name,
      slug: name,
      visibility,
      kind: "channel",
    }).room;
    // Public creation currently enrolls Workspace Humans. Exercise actual leave/rejoin.
    if (visibility === "public")
      for (const person of [reader!, other!])
        kernel.leaveRoom(person.actor, {
          roomId: room.roomId,
          basedOnRoomSeq: seq(room.roomId),
          idempotencyKey: "leave-" + person.principal.handle,
        });
    return room;
  };
  const publicRoom = channel("open"),
    privateRoom = channel("private", "private");
  const port = createHumanApplicationPort(kernel);
  const request = () => ({
    workspaceId: workspace.workspace.workspaceId,
    roomId: publicRoom.roomId,
    basedOnRoomSeq: seq(publicRoom.roomId),
    idempotencyKey: "join-reader",
  });
  return {
    kernel,
    db,
    people,
    workspace,
    publicRoom,
    privateRoom,
    port,
    request,
    seq,
    channel,
    databasePath,
    close() {
      db.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
