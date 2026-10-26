import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (name: string) =>
  readFileSync(`frontends/raft/loom/${name}.tsx`, "utf8");
test("multi-member memory policy uses official sheet with linked submit and busy protection", () => {
  const s = read("MemoryPolicyDialog");
  assert.match(s, /<DialogSheetContent/);
  assert.match(s, /<form\s+id=\{formId\}/);
  assert.match(s, /<DialogCommit\s+form=\{formId\}/);
  assert.match(s, /disabled=\{busy \|\| !base \|\| !policyPatch/);
  assert.match(s, /disablePointerDismissal/);
});
test("usage ledger uses a scrollable official sheet without a fake save action", () => {
  const s = read("RunUsageDialog");
  assert.match(s, /<DialogSheetContent/);
  assert.doesNotMatch(s, /DialogCommit/);
  assert.match(s, /signal: abort.signal/);
});
test("single-switch task permission and discard confirmation remain dialogs", () => {
  assert.match(read("TaskPermissionDialog"), /<DialogContent>/);
  assert.doesNotMatch(read("TaskPermissionDialog"), /DialogSheet/);
  assert.match(read("DiscardChangesDialog"), /AlertDialogContent/);
});
test("management sheets are opt-in only for long lists and multi-field forms", () => {
  assert.match(
    read("ManagementUi"),
    /sheet \? DialogSheetContent : DialogContent/,
  );
  assert.match(read("ChannelArchiveDialog"), /sheet=\{target === "list"\}/);
  assert.match(read("ChannelSidebar"), /sheet=\{edit.kind === "channel"\}/);
  assert.match(read("AgentPage"), /sheet=\{edit.kind === "edit"\}/);
});
