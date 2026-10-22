import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateConfirmation } from "./generate-confirmation.mjs";
test("confirmation uses unchanged official declarations and a parameter-only bridge", () => {
  const generated = readFileSync(
    "frontends/raft/loom/OfficialConfirmation.generated.tsx",
    "utf8",
  );
  assert.equal(generated, generateConfirmation());
  assert.match(generated, /actionSize = "lg"/);
  assert.match(generated, /variant="ghost"/);
  assert.match(generated, /dangerFrame/);
  const bridge = readFileSync(
    "frontends/raft/packages/web/src/components/ConfirmDialog.tsx",
    "utf8",
  );
  assert.doesNotMatch(bridge, /<Dialog|<Button|className=|useState/);
  assert.match(bridge, /OfficialConfirmation/);
});
