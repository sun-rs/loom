import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(
  join(import.meta.dirname, "..", "src", "components", "human-inbox.tsx"),
  "utf8",
);

test("Human Inbox owns the shared keyboard and focus dialog protocol", () => {
  assert.match(
    source,
    /const dialogRef = useDialogProtocol\(\{[\s\S]*?blocked: answering !== undefined,[\s\S]*?initialFocus: "container",[\s\S]*?onClose,[\s\S]*?\}\);/u,
  );
  assert.match(
    source,
    /aria-label="Human Inbox"[\s\S]*?aria-modal="true"[\s\S]*?ref=\{dialogRef\}[\s\S]*?role="dialog"[\s\S]*?tabIndex=\{-1\}/u,
  );
});
