import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("search field, all filter controls and empty states come from locked official JSX", async () => {
  const { generateSearchControls } =
    await import("./generate-search-controls.mjs");
  for (const [name, source] of Object.entries(generateSearchControls()))
    assert.equal(read("loom/" + name), source);
  for (const name of [
    "SearchHeader",
    "SearchFilters",
    "SearchIdentityFilter",
  ]) {
    const source = read("loom/" + name + ".tsx");
    assert.match(source, /OfficialSearchControls.generated/);
    assert.doesNotMatch(source, /className=|activeFilterClass/);
  }
  const generated = read("loom/OfficialSearchControls.generated.tsx");
  assert.match(generated, /data-has-value/);
  assert.doesNotMatch(generated, /shadow-raft-sm|bg-primary-soft/);
  assert.match(read("loom/DiscoveryPage.tsx"), /<SearchHomeEmpty/);
  assert.match(read("loom/DiscoveryPage.tsx"), /<SearchNoResults/);
});
test("search loading uses native result skeleton with one accessible loading region", () => {
  const s = read("loom/DiscoveryPage.tsx");
  assert.match(s, /<SearchLoading/);
  const search = s.slice(s.indexOf("<SearchLoading"));
  assert.doesNotMatch(search, /<Spinner/);
  assert.match(s, /mode === "activity" && pull.distance > 0/);
  const g = read("loom/OfficialSearchControls.generated.tsx");
  assert.match(g, /function SearchSkeleton/);
  assert.match(g, /role="status" aria-label="正在读取结果"/);
});
test("message empty state does not deny a matching channel or identity result", () => {
  assert.match(
    read("loom/DiscoveryPage.tsx"),
    /hasEntityResults=\{entities.results.length > 0\}/,
  );
  assert.match(
    read("loom/OfficialSearchControls.generated.tsx"),
    /!hasEntityResults && query.trim\(\)/,
  );
});
