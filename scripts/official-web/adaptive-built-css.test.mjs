import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../../frontends/raft/package.json", import.meta.url),
);
const postcss = require("postcss");
test("built md rail utilities carry touch 840 boundary, not bare desktop 768", () => {
  const dir = "frontends/raft/packages/web/dist-workbench/assets";
  let matched = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".css"))) {
    const root = postcss.parse(readFileSync(`${dir}/${file}`, "utf8"));
    root.walkRules((r) => {
      if (r.selector !== ".md\\:flex") return;
      matched++;
      let p = r.parent;
      const media = [];
      while (p) {
        if (p.type === "atrule" && p.name === "media") media.push(p.params);
        p = p.parent;
      }
      assert.ok(
        media.some((q) => q.includes("840") && q.includes("coarse")),
        `incorrect generated desktop utility: ${media}`,
      );
    });
  }
  assert.ok(matched > 0, "must inspect actual generated utility");
});
