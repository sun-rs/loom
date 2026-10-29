import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (file: string) =>
  readFileSync("frontends/raft/loom/" + file, "utf8");
test("both text pencils use the same revision editor with native initial-focus ownership", () => {
  const profile = read("RoleProfile.tsx");
  assert.match(profile, /editAction\("instructions", "提示词"\)/);
  assert.match(profile, /initialFocus=\{textFocus\}/);
  assert.match(
    read("RoleFieldEditor.tsx"),
    /field === "instructions" \? initialFocusRef/,
  );
  assert.match(read("MobileFormDialog.tsx"), /initialFocus=\{initialFocus\}/);
});
test("runtime info binds observed facts, never treats installation as remaining quota", () => {
  const profile = read("RoleProfile.tsx");
  assert.match(profile, /<RuntimeInfoChip/);
  const chip = read("RuntimeInfoChip.tsx");
  assert.match(chip, /OfficialRuntimeInfoFrame/);
  assert.match(chip, /账户额度/);
  assert.match(chip, /未提供/);
  assert.doesNotMatch(chip, /100%|余额充足|额度正常/);
});
test("runtime frame regenerates from independently acquired immutable source", async () => {
  const { generateRuntimeInfo } = await import("./generate-runtime-info.mjs");
  const { createHash } = await import("node:crypto");
  const root = "frontends/raft/upstream/runtime-info-2026-10-29/";
  const provenance = JSON.parse(readFileSync(root + "provenance.json", "utf8"));
  assert.equal(
    createHash("sha256")
      .update(readFileSync(root + "RuntimeAccountUsageChip.tsx"))
      .digest("hex"),
    provenance.sha256,
  );
  assert.equal(
    read("OfficialRuntimeInfo.generated.tsx"),
    generateRuntimeInfo(),
  );
  assert.match(
    read("OfficialRuntimeInfo.generated.tsx"),
    /HOVER_OPEN_DELAY_MS = 200/,
  );
  assert.match(
    read("OfficialRuntimeInfo.generated.tsx"),
    /HOVER_CLOSE_DELAY_MS = 160/,
  );
});
