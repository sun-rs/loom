import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveOfficialUi,
  officialUiAliases,
} from "../../frontends/raft/loom/ui-resolution.ts";
test("product UI alias binds JS and CSS to the same pinned package without intercepting other libraries", () => {
  const aliases = officialUiAliases();
  for (const source of [
    "raft-ui",
    "raft-ui/styles.css",
    "raft-ui/fonts.css",
    "raft-ui/cn",
  ]) {
    const matches = aliases.filter((a) => a.find.test(source));
    assert.equal(matches.length, 1);
    assert.equal(matches[0].replacement, resolveOfficialUi(source));
    assert.match(
      matches[0].replacement,
      /frontends\/raft\/node_modules\/raft-ui\/dist\//,
    );
  }
  assert.equal(
    aliases.some((a) => a.find.test("raft-ui-other")),
    false,
  );
  assert.equal(resolveOfficialUi("react"), null);
  const installed = JSON.parse(
    readFileSync(resolveOfficialUi("raft-ui/package.json"), "utf8"),
  );
  const pin = JSON.parse(readFileSync("frontends/raft/package.json", "utf8"))
    .dependencies["raft-ui"];
  assert.equal(installed.version, pin);
});
