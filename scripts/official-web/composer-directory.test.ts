import test from "node:test";
import assert from "node:assert/strict";
import { projectComposerChannels } from "../../frontends/raft/loom/composer-directory.ts";
test("composer directory projects only supplied accessible channels, preserves archive state and never adds private boxes", () => {
  const room = {
    roomId: "r",
    kind: "channel",
    name: "Visible",
    description: "description",
    createdAt: "2026-10-19T00:00:00Z",
  };
  const rows = projectComposerChannels([
    room,
    { ...room },
    { ...room, roomId: "box", instancePrivateBox: { instanceId: "i" } },
    { ...room, roomId: "side", side: {} },
    { ...room, roomId: "dm", kind: "direct" },
    { ...room, roomId: "old", archivedAt: "2026-10-19T01:00:00Z" },
  ] as never);
  assert.deepEqual(
    rows.map((x) => x.id),
    ["r", "old"],
  );
  assert.equal(rows[1].archivedAt, "2026-10-19T01:00:00Z");
  assert.equal(rows[0].description, "description");
});

test("directory binding changes only the composer read source and fails on upstream drift", async () => {
  const { adaptComposerDirectory } =
    await import("../../frontends/raft/loom/composer-directory-adaptation.ts");
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/message/MessageInput.tsx",
    "utf8",
  );
  const adapted = adaptComposerDirectory(source);
  assert.ok(adapted.includes("const channels = useComposerChannels();"));
  assert.ok(
    adapted.includes(
      "const dmChannels = useChannelStore((s) => s.dmChannels);",
    ),
  );
  assert.throws(
    () => adaptComposerDirectory("changed source"),
    /boundary changed/,
  );
});
