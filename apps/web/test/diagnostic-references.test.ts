import assert from "node:assert/strict";
import test from "node:test";
import { diagnosticReferenceParts } from "../src/diagnostic-references.ts";
test("diagnostic references resolve only unique visible Room slugs, never arbitrary paths or URLs", () => {
  const rooms = [
    { roomId: "r1", slug: "design", name: "Design", kind: "channel" },
    { roomId: "dm1", slug: "dm-alice", name: "Alice", kind: "direct" },
  ] as never;
  const parts = diagnosticReferenceParts(
    "target: #design:1234abcd; /tmp/secret; https://evil.test/#missing dm:@Alice",
    rooms,
  );
  assert.deepEqual(
    parts.filter((p) => p.target).map((p) => p.target),
    [{ roomId: "r1", messageId: "1234abcd" }, { roomId: "dm1" }],
  );
  assert.equal(
    diagnosticReferenceParts("#design", [
      ...rooms,
      { roomId: "r2", slug: "design", name: "Design", kind: "channel" },
    ]).some((p) => p.target),
    false,
  );
});
