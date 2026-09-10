import assert from "node:assert/strict";
import test from "node:test";
import { readUiSource } from "./ui-source.ts";

test("Search sender identities use the shared profile avatar, including directory metadata", () => {
  const source = readUiSource("components/global-discovery.tsx");
  const search = source.slice(source.indexOf("function GlobalSearch("));
  assert.match(search, /<ProfileImageAvatar/);
  assert.match(search, /entities\?\.resolvePerson\(person\)/);
  assert.doesNotMatch(
    search,
    /person.kind === "agent" \? "bot" : "user-round"/,
  );
});

test("Computer presentation shows the observed version and creation uses its public name", () => {
  assert.match(
    readUiSource("components/workspace-catalog-panes.tsx"),
    /Computer v\{computer\.buildVersion\}/,
  );
  assert.match(
    readUiSource("App.tsx"),
    /computerLabel=\{\s*computer\?\.displayName/,
  );
});
