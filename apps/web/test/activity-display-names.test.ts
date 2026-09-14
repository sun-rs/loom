import assert from "node:assert/strict";
import test from "node:test";
import { activityDisplayText } from "../src/activity-display-names.ts";
const human = {
  principalId: "owner-id",
  kind: "human" as const,
  handle: "owner",
  displayName: "Hakase",
};
test("activity excerpts resolve visible mentions to current Human display names", () => {
  const body =
    "😀 请@owner看看 @unknown owner@example.com @owner-extra `@owner` [@owner](https://example.com/@owner)";
  assert.equal(
    activityDisplayText(body, [human]),
    "😀 请@Hakase看看 @unknown owner@example.com @owner-extra `@owner` [@owner](https://example.com/@owner)",
  );
  assert.equal(
    activityDisplayText("@owner", [{ ...human, displayName: "博士" }]),
    "@博士",
  );
  assert.equal(
    activityDisplayText("@owner", [{ ...human, displayName: "" }]),
    "@owner",
  );
});
test("activity identity formatting preserves code, absent identities, and ambiguous handles", () => {
  const source = "~~~ts\n@owner\n~~~\n@owner";
  assert.equal(
    activityDisplayText(source, [human]),
    "~~~ts\n@owner\n~~~\n@Hakase",
  );
  assert.equal(activityDisplayText("@owner", []), "@owner");
  assert.equal(
    activityDisplayText("@owner", [human, { ...human, principalId: "other" }]),
    "@owner",
  );
});
