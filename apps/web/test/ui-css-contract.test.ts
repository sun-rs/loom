import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import {
  cssContractInputs,
  runtimeCssVariableOwners,
  unresolvedCssVariables,
} from "../../../scripts/ui-css-contract.mjs";

test("CSS variable contract rejects missing and misspelled names, including fallback dependencies", () => {
  assert.deepEqual(
    unresolvedCssVariables({
      "tokens.css": ":root { --green: #a9d877; } /* var(--comment) */",
      "page.css":
        ".x { color: var(--green); background: var(--lime); border-color: var(--optional, var(--ink-30)); }",
    }),
    ["page.css: --ink-30", "page.css: --lime"],
  );
});

test("CSS literals and documented inline component properties are valid, not global prefix exemptions", () => {
  assert.deepEqual(
    unresolvedCssVariables({
      "page.css": ".x { width:var(--rah-size); color:var(--missing, red); }",
      "component.tsx": 'const style = { "--rah-size": "20px" };',
    }),
    [],
  );
  assert.deepEqual(
    unresolvedCssVariables({ "page.css": ".x {width:var(--rah-typo)}" }),
    ["page.css: --rah-typo"],
  );
});

test("all maintained product CSS resolves to declared tokens or explicit fallbacks", () => {
  assert.deepEqual(
    unresolvedCssVariables(
      cssContractInputs(),
      Object.keys(runtimeCssVariableOwners),
    ),
    [],
  );
});

test("the registered Base UI property is supplied by the installed positioning owner", () => {
  const require = createRequire(import.meta.url);
  const packageRoot = dirname(require.resolve("@base-ui/react/package.json"));
  const positioning = readFileSync(
    resolve(packageRoot, "utils/useAnchorPositioning.js"),
    "utf8",
  );
  assert.equal(Object.keys(runtimeCssVariableOwners).length, 1);
  assert.match(positioning, /setProperty\(['"]--available-height['"]/);
});

test("registered runtime CSS properties are exact names, not a prefix exemption", () => {
  assert.deepEqual(
    unresolvedCssVariables(
      {
        "popover.css":
          ".x { max-height:var(--available-height); width:var(--available-heigth); }",
      },
      ["--available-height"],
    ),
    ["popover.css: --available-heigth"],
  );
});
