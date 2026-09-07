import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(
  join(import.meta.dirname, "..", "src", "components", "human-inbox.tsx"),
  "utf8",
);

test("Human Inbox delegates nonmodal interaction to the shared popover; answering stays modal", () => {
  assert.match(
    source,
    /<InteractivePopoverContent\s+blocked=\{answering !== undefined\}\s+label="Human Inbox"/u,
  );
  assert.match(source, /useDialogProtocol\(\{ blocked: pending, onClose \}\)/u);
  assert.match(
    source,
    /aria-labelledby="rah-input-request-title"\s+aria-modal="true"/u,
  );
  assert.doesNotMatch(source, /rah-notification-backdrop/u);
  assert.match(
    source,
    /useEffect\(\(\) => \{[\s\S]*?request\.inputRequestId === answering\.inputRequestId[\s\S]*?request\.state === "pending"[\s\S]*?setAnswering\(undefined\);[\s\S]*?\}, \[answering, requests\]\);/u,
  );
});
