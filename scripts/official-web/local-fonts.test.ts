import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { localizeFontCss } from "../../frontends/raft/loom/local-fonts.ts";
test("official font contract retains families, weights and ranges while removing network dependencies", () => {
  const native = readFileSync(
    "frontends/raft/node_modules/raft-ui/dist/fonts.css",
    "utf8",
  );
  const result = localizeFontCss(native);
  assert.equal(
    localizeFontCss(native.replace('url("', '"').replace('");', '";')),
    result,
  );
  assert.ok(!result.includes("https://"));
  assert.equal(
    result.slice(result.indexOf(":where")),
    native.slice(native.indexOf(":where")),
  );
  for (const family of ["Space Grotesk", "Space Mono"])
    assert.ok(
      result.includes(`font-family: '${family}'`) ||
        result.includes(`font-family: "${family}"`),
    );
  assert.match(result, /unicode-range:/);
  assert.match(result, /font-display: swap/);
  const manifest = JSON.parse(
    readFileSync("frontends/raft/loom/fonts/provenance.json", "utf8"),
  );
  for (const file of manifest.files)
    assert.equal(
      createHash("sha256")
        .update(readFileSync("frontends/raft/loom/fonts/" + file.file))
        .digest("hex"),
      file.sha256,
    );
  assert.throws(
    () =>
      localizeFontCss('@import url("https://fonts.googleapis.com/changed");'),
    /Unmapped/,
  );
});
