import test from "node:test";
import assert from "node:assert/strict";
import { channelMetadataPayload } from "../../frontends/raft/loom/channel-settings.ts";
test("metadata edit keeps captured basis and visibility, excludes task/execution policy", () => {
  const room = {
    roomId: "r",
    name: "old",
    description: "old",
    visibility: "private",
    allowInstanceTaskCreation: true,
  };
  assert.deepEqual(
    channelMetadataPayload(room as never, 42, " new ", " description "),
    {
      roomId: "r",
      basedOnRoomSeq: 42,
      name: "new",
      description: "description",
      visibility: "private",
    },
  );
});

test("settings action rows use locked official B7 small button size", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL(
      "../../frontends/raft/packages/web/src/components/ui/OverflowSheet.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const action = source
    .split("export function OverflowActionRow(")[1]
    .split("export function OverflowCommandRow(")[0];
  assert.ok(action.includes('size="sm"'));
});
