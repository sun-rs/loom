import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("search history, recent, frequent, grouped messages and footer use reproducible source sections", async () => {
  const { generateSearchSections } =
    await import("./generate-search-sections.mjs");
  for (const [name, source] of Object.entries(generateSearchSections()))
    assert.equal(read("loom/" + name), source, name);
  for (const name of [
    "History",
    "Recent",
    "Frequent",
    "MessageGroups",
    "LoadMore",
  ]) {
    const adapter = read("loom/Search" + name + ".tsx");
    assert.match(adapter, /OfficialSearchSections.generated/);
    assert.doesNotMatch(
      adapter,
      /className=|<Badge|<SearchThreadResult|<SearchResultsSectionHeading/,
    );
  }
});
test("history text actions use the exact official TextLink dependency", () => {
  assert.match(
    read("packages/web/src/components/ui/TextLink.tsx"),
    /@loom\/raft-web-source\/TextLink/,
  );
});
