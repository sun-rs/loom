import assert from "node:assert/strict";
import test from "node:test";
import { assertOfficialFrontendReady } from "../build-product-web.mjs";
test("unconnected official UI cannot silently become the installed Loom product", () => {
  assert.throws(
    () => assertOfficialFrontendReady({ productConnected: false }),
    /not connected/,
  );
  assert.throws(() => assertOfficialFrontendReady({}), /not connected/);
  assert.doesNotThrow(() =>
    assertOfficialFrontendReady({ productConnected: true }),
  );
});

test("integration acceptance builds the same product entry and exposes no obsolete paid shortcuts", async () => {
  const { readFile, access } = await import("node:fs/promises");
  const { scripts } = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(
    scripts["build:official-web:channel"],
    "npm run typecheck:loom --prefix frontends/raft && npm run build:web:workbench",
  );
  await assert.rejects(access("scripts/official-web/build-channel.mjs"), {
    code: "ENOENT",
  });
  assert.equal(scripts["test:real:codex:sol-low"], undefined);
  assert.equal(scripts["test:real:opencode:deepseek-v4-flash"], undefined);
});

test("browser acceptance does not bypass the data router with synthetic empty-state POP", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  for (const name of await readdir("scripts/official-web")) {
    if (!name.endsWith("-browser.mjs")) continue;
    assert.doesNotMatch(
      await readFile(`scripts/official-web/${name}`, "utf8"),
      /history\.pushState\(\{\}/,
      name,
    );
  }
});
