import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
const root = resolve(import.meta.dirname, "../../frontends/raft");
test("official source intake preserves recorded upstream source bytes and license", async () => {
  const adoption = JSON.parse(
    await readFile(resolve(root, "adoption.json"), "utf8"),
  );
  assert.equal(adoption.revision, "a98ae003246a0360872a77d76dec2fccd0347ef7");
  assert.equal(adoption.productConnected, true);
  assert.equal(adoption.rollout.stage, "instance-add-v4");
  assert.equal(adoption.rollout.consoleRetained, true);
  assert.ok(
    adoption.files["packages/web/src/components/layout/MainLayout.tsx"],
  );
  assert.ok(
    adoption.files["packages/web/src/components/message/ChatPanel.tsx"],
  );
  await access(resolve(root, "LICENSE"));
  for (const [name, digest] of Object.entries(adoption.files)) {
    const bytes = await readFile(resolve(root, name));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      digest,
      name,
    );
  }
});
