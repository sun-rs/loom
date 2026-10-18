import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(p, "utf8");
test("product pins the single Raft design system", () => {
  assert.equal(
    JSON.parse(read("frontends/raft/package.json")).dependencies["raft-ui"],
    "0.6.0",
  );
  assert.equal(
    JSON.parse(read("frontends/raft/packages/web/package.json")).dependencies[
      "raft-ui"
    ],
    "0.6.0",
  );
});
test("existing device mode survives removal of visual families", async () => {
  const { readMode, modeKey } =
    await import("../../frontends/raft/loom/theme-mode.ts");
  for (const [data, want] of [
    [{}, "system"],
    [{ "slock-theme-preset": "brutal" }, "light"],
    [{ "slock-theme-preset": "elegant-dark" }, "dark"],
    [
      {
        "slock-theme-preferences-v2":
          '{"mode":"system","lightThemeId":"brutal"}',
      },
      "system",
    ],
    [{ [modeKey]: "dark" }, "dark"],
  ])
    assert.equal(readMode({ getItem: (k) => data[k] ?? null }), want);
});
test("installed official resources match the reviewed immutable lock", async () => {
  const { createHash } = await import("node:crypto");
  const lock = JSON.parse(read("frontends/raft/rui-resources.lock.json"));
  assert.equal(lock.version, "0.6.0");
  for (const [path, expected] of Object.entries({
    ...lock.files,
    ...lock.guides,
  }))
    assert.equal(
      createHash("sha256")
        .update(readFileSync("frontends/raft/node_modules/raft-ui/" + path))
        .digest("hex"),
      expected,
      path,
    );
});
test("first paint migrates mode without restoring a removed family", async () => {
  const { runInNewContext } = await import("node:vm");
  for (const dark of [false, true]) {
    const classes = new Set(),
      root = {
        style: {},
        removeAttribute: (name) => assert.equal(name, "data-theme"),
        classList: {
          toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
        },
      };
    runInNewContext(
      read("frontends/raft/packages/web/public/app-theme-bootstrap.js"),
      {
        document: { documentElement: root },
        localStorage: { getItem: () => null },
        matchMedia: () => ({ matches: dark }),
      },
    );
    assert.ok(classes.has(dark ? "dark" : "light"));
    assert.equal(root.style.colorScheme, dark ? "dark" : "light");
  }
});
