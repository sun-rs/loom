import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { auditDialogActions } from "./audit-dialog-actions.mjs";
test("all product paired dialog actions put cancel before primary in DOM; native recipes own visual stacking", () => {
  const audit = auditDialogActions();
  assert.ok(audit.rows.length >= 15);
  assert.deepEqual(audit.violations, []);
  for (const file of [
    "OfficialConfirmation.generated.tsx",
    "RoleFieldEditor.tsx",
    "MemoryEditor.tsx",
    "CreateInstanceDialog.tsx",
    "ComputerFiles.tsx",
    "ChannelSettingsContent.tsx",
  ])
    assert.ok(
      audit.rows.some((r) => r.file.endsWith("/" + file) && r.hasPair),
      file,
    );
  const stacked = readFileSync(
    "frontends/raft/node_modules/raft-ui/dist/lib/stacked-actions.mjs",
    "utf8",
  );
  assert.match(stacked, /data-stacked:flex-col-reverse/);
  const sheet = readFileSync(
    "frontends/raft/node_modules/raft-ui/dist/components/dialog/dialog-sheet.mjs",
    "utf8",
  );
  assert.match(sheet, /commitSlot/);
});
test("native Computer inline editor intentionally retains save before cancel", () => {
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/machine/MachineDetailPanel.tsx",
    "utf8",
  );
  assert.match(
    source,
    /onClick=\{handleSaveRenameClick\}[\s\S]*?machine\.detail\.save[\s\S]*?onClick=\{handleCancelRename\}[\s\S]*?common\.confirm\.cancel/,
  );
  const row = auditDialogActions().rows.find(
    (r) => r.file === "loom/ComputerProfile.tsx",
  );
  assert.equal(row.kind, "nonmodal-actions");
  assert.deepEqual(
    row.actions.map((a) => a.kind),
    ["primary", "cancel"],
  );
});
