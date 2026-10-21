import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("shell shared dependencies and computer profile use locked source boundaries", async () => {
  const { generateComputerProfile } =
    await import("./generate-computer-profile.mjs");
  assert.equal(
    read("loom/OfficialComputerProfile.generated.tsx"),
    generateComputerProfile(),
  );
  assert.match(read("loom/ComputersPage.tsx"), /<OfficialComputerProfile/);
  assert.doesNotMatch(read("loom/ComputersPage.tsx"), /size-\[51px\]/);
  for (const [path, name] of [
    ["components/ui/PanelResizeHandle.tsx", "PanelResizeHandle"],
    ["hooks/useResizablePanel.ts", "useResizablePanel"],
  ])
    assert.match(
      read("packages/web/src/" + path),
      new RegExp("@loom/raft-web-source/" + name),
    );
  assert.match(
    read("packages/web/src/components/ui/AvatarSlot.tsx"),
    /OfficialAvatarSlot.generated/,
  );
});
