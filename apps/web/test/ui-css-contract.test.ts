import assert from "node:assert/strict";
import test from "node:test";
import {
  cssContractInputs,
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
  assert.deepEqual(unresolvedCssVariables(cssContractInputs()), []);
});
