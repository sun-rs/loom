import assert from "node:assert/strict";
import test from "node:test";
import {
  collectTokens,
  committedRatchet,
  componentSpecErrors,
  cssInputsDigest,
  deriveTokenLiteral,
  isComponentScopedSelector,
  loadComponentSpecs,
  matchedRulesErrors,
  normalizeLiteral,
  parseCssRules,
  provenanceErrors,
  ratchetErrors,
  resolveValue,
  selectorMentions,
  tokenContractErrors,
} from "./ui-component-spec.mjs";
import { readFileSync } from "node:fs";

// Synthetic specs carry no provenance, tokenContract or matched-rules report,
// so only the checks they do declare run; the ratchet is a repository-wide
// gate and is exercised on its own below.
const SOLO = { skipRatchet: true };
import { cssContractInputs } from "./ui-css-contract.mjs";

test("parseCssRules drops comments and splits grouped selectors", () => {
  const rules = parseCssRules(
    `/* .ghost { width: 1px } */
     .a, .b { width: 2px; height: 3px }`,
    "x.css",
  );
  assert.deepEqual(
    rules.map((rule) => rule.selector),
    [".a", ".b"],
  );
  assert.deepEqual(rules[0].declarations, { width: "2px", height: "3px" });
  assert.equal(rules[0].media, "");
});

test("a grouped selector's declarations do not leak to its siblings", () => {
  // componentSpecErrors merges a repeated selector by mutating the first
  // rule's declarations. If the selectors of one group shared a declarations
  // object, that mutation would land on every sibling too, and `.a` would
  // appear to declare a property only `.b` ever had.
  const inputs = { "x.css": ".a, .b { width: 2px } .b { height: 9px }" };
  const errors = componentSpecErrors(
    {
      component: "grouped",
      classNames: [".a", ".b"],
      rules: [
        {
          file: "x.css",
          selector: ".a",
          state: "base",
          source: "docs/evidence/x",
          reason: "the group member under test",
          declarations: { width: "2px" },
        },
        {
          file: "x.css",
          selector: ".b",
          state: "base",
          source: "docs/evidence/x",
          reason: "the sibling that is repeated later",
          declarations: { width: "2px", height: "9px" },
        },
      ],
    },
    inputs,
    { skipRatchet: true, skipMatchedRules: true },
  );
  assert.deepEqual(errors, []);
});

test("parseCssRules keeps commas inside :is() and records @media", () => {
  const rules = parseCssRules(
    `@media (max-width: 860px) { .x :is(.sq-btn, .send-btn), .y { display: none } }`,
    "x.css",
  );
  assert.deepEqual(
    rules.map((rule) => rule.selector),
    [".x :is(.sq-btn, .send-btn)", ".y"],
  );
  assert.equal(rules[0].media, "@media (max-width: 860px)");
});

test("resolveValue expands var() chains and evaluates calc()", () => {
  const tokens = collectTokens({
    "t.css":
      ":root { --bw-2: 2px; --bd: var(--bw-2) solid var(--black); --black: #000; --icon: 14px; --space-1: 4px }",
  });
  assert.equal(resolveValue("var(--bd)", tokens), "2px solid #000");
  assert.equal(
    resolveValue(
      "calc(var(--icon) + 2 * var(--space-1) + 2 * var(--bw-2))",
      tokens,
    ),
    "26px",
  );
  assert.equal(resolveValue("var(--missing, 9px)", tokens), "9px");
});

test("selectorMentions matches a class token, never a prefix", () => {
  assert.equal(
    selectorMentions(".composer-bar .sq-btn:hover", ".sq-btn"),
    true,
  );
  assert.equal(selectorMentions(".sq-btn.sm", ".sq-btn"), true);
  assert.equal(selectorMentions(".sq-btn-extra", ".sq-btn"), false);
  assert.equal(selectorMentions(".send-btn", ".sq-btn"), false);
});

test("componentSpecErrors reports a declaration that drifted from the spec", () => {
  const errors = componentSpecErrors(
    {
      component: "demo",
      classNames: [".sq-btn"],
      rules: [
        {
          file: "s.css",
          selector: ".sq-btn",
          state: "base",
          source: "docs/evidence/x.css",
          reason: "upstream base",
          declarations: { width: "28px" },
        },
      ],
      overrides: [],
    },
    { "s.css": ":root { --w: 30px } .sq-btn { width: var(--w) }" },
    SOLO,
  );
  assert.deepEqual(errors, [
    "demo s.css .sq-btn [base]: width expected 28px, resolved 30px",
  ]);
});

test("componentSpecErrors fails an unregistered rule that mentions the component", () => {
  const errors = componentSpecErrors(
    {
      component: "demo",
      classNames: [".sq-btn"],
      rules: [],
      overrides: [],
    },
    { "s.css": ".pane .sq-btn { opacity: .5 }" },
    SOLO,
  );
  assert.deepEqual(errors, [
    "demo: unregistered rule s.css .pane .sq-btn — add it to rules or overrides with source and reason",
  ]);
});

test("componentSpecErrors requires source and reason on every entry", () => {
  const errors = componentSpecErrors(
    {
      component: "demo",
      classNames: [".sq-btn"],
      rules: [],
      overrides: [
        {
          file: "s.css",
          selector: ".sq-btn",
          reason: "why",
          since: "2026-09-11",
          evidenceNeeded: "x",
        },
      ],
    },
    { "s.css": ".sq-btn { opacity: .5 }" },
    SOLO,
  );
  assert.deepEqual(errors, [
    "demo s.css .sq-btn: overrides entry needs a source",
  ]);
});

test("componentSpecErrors refuses an override whose source is not evidence", () => {
  const errors = componentSpecErrors(
    {
      component: "demo",
      classNames: [".sq-btn"],
      rules: [],
      overrides: [
        {
          file: "s.css",
          selector: ".sq-btn",
          source: "because I said so",
          reason: "why",
          since: "2026-09-11",
          evidenceNeeded: "x",
        },
      ],
    },
    { "s.css": ".sq-btn { opacity: .5 }" },
    SOLO,
  );
  assert.deepEqual(errors, [
    'demo s.css .sq-btn: override source must point at docs/evidence/ or an upstream bundle offset, got "because I said so"',
  ]);
});

test("a REGISTERED-UNRESOLVED override must name an existing pending id", () => {
  const base = {
    component: "demo",
    classNames: [".sq-btn"],
    rules: [],
    pending: [
      {
        id: "narrow-hide",
        question: "?",
        since: "2026-09-11",
        evidenceNeeded: "x",
      },
    ],
  };
  const entry = {
    file: "s.css",
    selector: ".sq-btn",
    status: "registered-unresolved",
    source: "s.css:1",
    reason: "no upstream evidence yet",
    since: "2026-09-11",
    evidenceNeeded: "x",
  };
  assert.deepEqual(
    componentSpecErrors(
      { ...base, overrides: [{ ...entry, pending: "narrow-hide" }] },
      { "s.css": ".sq-btn { opacity: .5 }" },
      SOLO,
    ),
    [],
  );
  assert.deepEqual(
    componentSpecErrors(
      { ...base, overrides: [{ ...entry, pending: "invented" }] },
      { "s.css": ".sq-btn { opacity: .5 }" },
      SOLO,
    ),
    [
      'demo s.css .sq-btn: REGISTERED-UNRESOLVED override must name a pending id, got "invented"',
    ],
  );
});

test("componentSpecErrors fails a spec rule that no stylesheet declares", () => {
  const errors = componentSpecErrors(
    {
      component: "demo",
      classNames: [".sq-btn"],
      rules: [
        {
          file: "s.css",
          selector: ".sq-btn:disabled",
          state: "disabled",
          source: "docs/evidence/x.css",
          reason: "upstream disabled",
          declarations: { opacity: "0.4" },
        },
      ],
      overrides: [],
    },
    { "s.css": ".sq-btn { width: 28px }" },
    SOLO,
  );
  assert.deepEqual(errors, [
    "demo s.css .sq-btn:disabled [disabled]: no such rule in the parsed CSS",
    "demo: unregistered rule s.css .sq-btn — add it to rules or overrides with source and reason",
  ]);
});

test("the shipped sq-btn spec holds against the real stylesheets", () => {
  const specs = loadComponentSpecs();
  assert.ok(specs.some((spec) => spec.component === "sq-btn"));
  const inputs = cssContractInputs();
  // The ratchet's "must be committed" half has its own test below; here the
  // working-tree ratchet stands in for HEAD so the rest of the spec is what
  // this assertion is about.
  const workingAsCommitted = {
    present: true,
    value: JSON.parse(
      readFileSync("packages/ui-tokens/specs/ratchet.json", "utf8"),
    ),
  };
  const errors = specs.flatMap((spec) =>
    componentSpecErrors(spec, inputs, {
      committedRatchet: workingAsCommitted,
    }),
  );
  assert.deepEqual(errors, []);
});

// ---------------------------------------------------------------------------
// Batch 2 (spec doc §批次 2：校验器加固). Each test below fails against the
// batch-1 checker and passes against this one.
// ---------------------------------------------------------------------------

test("normalizeLiteral folds whitespace, bare decimals, zero units and the two upstream oklch greys", () => {
  assert.equal(
    normalizeLiteral("2px  2px   0px  #141111"),
    "2px 2px 0 #141111",
  );
  assert.equal(
    normalizeLiteral("cubic-bezier(.4, 0, .2, 1)"),
    "cubic-bezier(0.4, 0, 0.2, 1)",
  );
  assert.equal(
    normalizeLiteral("cubic-bezier(0.4,0,0.2,1)"),
    "cubic-bezier(0.4, 0, 0.2, 1)",
  );
  assert.equal(
    normalizeLiteral("2px 2px 0 #141111"),
    normalizeLiteral("2px 2px 0px #141111"),
  );
  assert.equal(
    normalizeLiteral("2px solid oklch(0% 0 0)"),
    "2px solid #000000",
  );
  assert.equal(normalizeLiteral("2px solid #000"), "2px solid #000000");
  // A real colour divergence must survive normalization.
  assert.notEqual(normalizeLiteral("#141111"), normalizeLiteral("#000000"));
});

// Requirement 1 --------------------------------------------------------------

test("req1: an expectation that names a RAH token is itself the failure", () => {
  const spec = {
    component: "demo",
    classNames: [".sq-btn"],
    overrides: [],
    rules: [
      {
        file: "s.css",
        selector: ".sq-btn",
        state: "base",
        source: "docs/evidence/x.css",
        reason: "upstream base",
        declarations: { width: "var(--control-7)" },
      },
    ],
  };
  const inputs = {
    "s.css": ":root { --control-7: 99px } .sq-btn { width: var(--control-7) }",
  };
  // Batch 1 resolved both sides through the same token and passed.
  assert.deepEqual(componentSpecErrors(spec, inputs, SOLO), [
    'demo s.css .sq-btn [base]: width expectation "var(--control-7)" references a RAH token; write the upstream literal instead',
  ]);
  // With the upstream literal in place, the drifted token is caught.
  assert.deepEqual(
    componentSpecErrors(
      {
        ...spec,
        rules: [{ ...spec.rules[0], declarations: { width: "28px" } }],
      },
      inputs,
      SOLO,
    ),
    ["demo s.css .sq-btn [base]: width expected 28px, resolved 99px"],
  );
});

test("req1: a browserExpectation may not name a RAH token either", () => {
  assert.deepEqual(
    componentSpecErrors(
      {
        component: "demo",
        classNames: [],
        rules: [],
        overrides: [],
        browserExpectations: {
          "1440x900/sq-btn/base/width": "var(--control-7)",
        },
      },
      {},
      SOLO,
    ),
    [
      'demo: browserExpectation 1440x900/sq-btn/base/width "var(--control-7)" references a RAH token; write the literal the browser computes',
    ],
  );
});

// Requirement 2 --------------------------------------------------------------

test("req2: a geometry token is recomputed from the upstream --spacing, so 28 -> 99 fails", () => {
  const upstream = collectTokens({
    "e.css": ":root { --spacing: .25rem; --font-weight-bold: 700 }",
  });
  assert.equal(
    deriveTokenLiteral({ kind: "spacing-multiple", factor: 7 }, upstream),
    "28px",
  );
  assert.equal(
    deriveTokenLiteral(
      { kind: "upstream-var", name: "--font-weight-bold" },
      upstream,
    ),
    "700",
  );
  assert.equal(
    deriveTokenLiteral(
      {
        kind: "sum",
        parts: [
          { kind: "literal", value: "20px" },
          { kind: "spacing-multiple", factor: 1, times: 2 },
          { kind: "literal", value: "2px", times: 2 },
        ],
      },
      upstream,
    ),
    "32px",
  );
  const spec = {
    component: "demo",
    tokenContract: [
      {
        token: "--control-7",
        source: "docs/evidence/x.css :root --spacing",
        derivation: { kind: "spacing-multiple", factor: 7 },
      },
    ],
  };
  assert.deepEqual(
    tokenContractErrors(
      spec,
      collectTokens({ "t.css": ":root { --control-7: 28px }" }),
      upstream,
    ),
    [],
  );
  assert.deepEqual(
    tokenContractErrors(
      spec,
      collectTokens({ "t.css": ":root { --control-7: 99px }" }),
      upstream,
    ),
    [
      "demo tokenContract --control-7: upstream derivation gives 28px, RAH declares 99px",
    ],
  );
});

test("req2: the real sq-btn tokenContract recomputes every geometry token from the frozen evidence", () => {
  const spec = loadComponentSpecs().find((item) => item.component === "sq-btn");
  const upstream = collectTokens({
    [spec.provenance.cssFile]: readFileSync(spec.provenance.cssFile, "utf8"),
  });
  assert.ok(spec.tokenContract.length >= 10);
  assert.deepEqual(
    tokenContractErrors(spec, collectTokens(cssContractInputs()), upstream),
    [],
  );
});

// Requirement 3 --------------------------------------------------------------

test("req3: provenance sha256 is computed, so writing 64 zeros fails", () => {
  const spec = loadComponentSpecs().find((item) => item.component === "sq-btn");
  assert.deepEqual(provenanceErrors(spec), []);
  const zeroed = {
    ...spec,
    provenance: { ...spec.provenance, cssSha256: "0".repeat(64) },
  };
  assert.deepEqual(provenanceErrors(zeroed), [
    `demo-placeholder`.replace(
      "demo-placeholder",
      `sq-btn: provenance.cssSha256 says ${"0".repeat(64)} but ${spec.provenance.cssFile} hashes to ${spec.provenance.cssSha256}`,
    ),
  ]);
});

test("req3: a misquoted upstream declaration is caught against the evidence CSS", () => {
  const spec = loadComponentSpecs().find((item) => item.component === "sq-btn");
  const base = spec.upstreamRules.find(
    (rule) => rule.selector === ".btn-brutal-sm",
  );
  assert.equal(base.declarations["border-width"], "2px");
  assert.equal(base.declarations["--tw-shadow"], "2px 2px 0px #141111");
  const tampered = {
    ...spec,
    upstreamRules: [
      {
        ...base,
        declarations: { ...base.declarations, "border-width": "5px" },
      },
      {
        selector: ".btn-brutal-invented",
        media: "@layer components",
        declarations: {},
      },
    ],
  };
  assert.deepEqual(provenanceErrors(tampered), [
    "sq-btn upstreamRules .btn-brutal-sm: border-width quoted as 5px, evidence says 2px",
    `sq-btn upstreamRules .btn-brutal-invented: not present in ${spec.provenance.cssFile}`,
  ]);
});

test("req3: a missing evidence file is a failure, not a skip", () => {
  const errors = provenanceErrors(
    {
      component: "demo",
      provenance: {
        cssFile: "docs/evidence/gone.css",
        cssSha256: "a".repeat(64),
        jsFile: "docs/evidence/gone.js",
        jsSha256: "b".repeat(64),
      },
    },
    () => {
      throw new Error("ENOENT");
    },
  );
  assert.deepEqual(errors, [
    "demo: provenance.cssFile docs/evidence/gone.css does not exist",
    "demo: provenance.jsFile docs/evidence/gone.js does not exist",
  ]);
});

// Requirement 4 --------------------------------------------------------------

test("req4: raising the working-tree budget above the committed ratchet is inert", () => {
  const committed = {
    present: true,
    value: { "sq-btn": { overrides: 6, pending: 8, overrideBudget: 6 } },
  };
  // Holding steady is fine.
  assert.deepEqual(
    ratchetErrors(
      "sq-btn",
      { overrides: 6, pending: 8 },
      { overrides: 6, pending: 8, overrideBudget: 6 },
      committed,
    ),
    [],
  );
  // The reproduced attack: +5 budget in the working tree and a new override.
  assert.deepEqual(
    ratchetErrors(
      "sq-btn",
      { overrides: 7, pending: 8 },
      { overrides: 11, pending: 8, overrideBudget: 11 },
      committed,
    ),
    [
      "sq-btn: working-tree overrides ratchet rose to 11; lower it instead of raising the committed 6 ratchet",
      "sq-btn: working-tree overrideBudget ratchet rose to 11; lower it instead of raising the committed 6 ratchet",
      "sq-btn: overrides rose to 7; close an exception instead of raising the committed 6 ratchet",
    ],
  );
});

test("req4: an uncommitted ratchet counts as zero and fails", () => {
  const errors = ratchetErrors(
    "sq-btn",
    { overrides: 6, pending: 8 },
    { overrides: 6, pending: 8, overrideBudget: 6 },
    { present: false, value: {} },
  );
  assert.ok(
    errors.includes(
      "sq-btn: packages/ui-tokens/specs/ratchet.json is not committed at HEAD, so every committed value counts as 0; commit the ratchet before it can hold anything back",
    ),
  );
  assert.ok(errors.some((line) => line.includes("overrides rose to 6")));
});

test("req4: the budget no longer lives in the spec", () => {
  const errors = componentSpecErrors(
    {
      component: "demo",
      classNames: [],
      rules: [],
      overrides: [],
      overrideBudget: 99,
    },
    {},
    SOLO,
  );
  assert.deepEqual(errors, [
    "demo: overrideBudget moved to packages/ui-tokens/specs/ratchet.json; remove it from the spec",
  ]);
  // committedRatchet reads only HEAD; it never falls back to the working tree.
  const head = committedRatchet(
    "packages/ui-tokens/specs/definitely-absent.json",
  );
  assert.equal(head.present, false);
});

// Requirement 5 --------------------------------------------------------------

test("req5: every override and pending must say when it opened and what would close it", () => {
  const errors = componentSpecErrors(
    {
      component: "demo",
      classNames: [".sq-btn"],
      rules: [],
      pending: [
        { id: "q", question: "?" },
        { id: "q", question: "dup" },
      ],
      overrides: [
        {
          file: "s.css",
          selector: ".sq-btn",
          source: "docs/evidence/a.css",
          reason: "a",
        },
      ],
    },
    { "s.css": ".sq-btn { opacity: .5 }" },
    SOLO,
  );
  assert.deepEqual(errors, [
    "demo pending q: duplicate pending id",
    "demo pending q: needs evidenceNeeded",
    "demo pending q: needs since",
    "demo s.css .sq-btn: override needs evidenceNeeded",
    "demo s.css .sq-btn: override needs since",
  ]);
});

test("req5: the shipped spec carries since and evidenceNeeded on every exception", () => {
  const spec = loadComponentSpecs().find((item) => item.component === "sq-btn");
  for (const entry of [...spec.overrides, ...spec.pending])
    for (const field of ["since", "evidenceNeeded"])
      assert.equal(
        typeof entry[field],
        "string",
        `${entry.selector ?? entry.id} ${field}`,
      );
});

// Requirement 6 --------------------------------------------------------------

test("req6: a rule that matches the element but never spells the class is surfaced", () => {
  const inputs = {
    "c.css": ".pickers .picker:disabled { opacity: .4; pointer-events: none }",
  };
  const parsed = parseCssRules(inputs["c.css"], "c.css");
  const report = {
    cssInputsSha256: cssInputsDigest(inputs),
    probes: {
      "composer-picker-disabled": [
        {
          selector: ".pickers .picker:disabled",
          media: "",
          properties: ["opacity", "pointer-events"],
        },
      ],
    },
  };
  // The class-name-text check (batch 1) never sees this rule at all.
  assert.equal(selectorMentions(".pickers .picker:disabled", ".sq-btn"), false);
  assert.deepEqual(
    matchedRulesErrors(
      { component: "demo" },
      inputs,
      report,
      new Set(),
      parsed,
    ),
    [
      'demo: unregistered rule c.css .pickers .picker:disabled matches the "composer-picker-disabled" fixture element and sets opacity, pointer-events — register it in rules or overrides with source and reason',
    ],
  );
  // Registering it clears the finding.
  assert.deepEqual(
    matchedRulesErrors(
      { component: "demo" },
      inputs,
      report,
      new Set(["c.css||||.pickers .picker:disabled"]),
      parsed,
    ),
    [],
  );
});

test("req6: a matched-rules report is refused once the CSS inputs change", () => {
  const inputs = { "c.css": ".a { width: 1px }" };
  const stale = { cssInputsSha256: "0".repeat(64), probes: {} };
  assert.deepEqual(
    matchedRulesErrors({ component: "demo" }, inputs, stale, new Set(), []),
    [
      `demo: the matched-rules report was produced from CSS hashing ${"0".repeat(64)}, the tree now hashes to ${cssInputsDigest(inputs)}; re-run the browser gate with --report-matching-rules`,
    ],
  );
  assert.deepEqual(
    matchedRulesErrors(
      { component: "demo", matchedRulesFile: "r.json" },
      inputs,
      undefined,
      new Set(),
      [],
    ),
    [
      "demo: r.json is missing; run node scripts/run-sq-btn-spec-browser-gate.mjs --report-matching-rules",
    ],
  );
});

test("req6: element defaults are the reset layer's business, a classed selector is this spec's", () => {
  assert.equal(isComponentScopedSelector("*"), false);
  assert.equal(isComponentScopedSelector("button"), false);
  assert.equal(
    isComponentScopedSelector(
      ":where(.rah-product-shell, .rah-dialog-layer) :where(button)",
    ),
    false,
  );
  assert.equal(
    isComponentScopedSelector(".rah-product-shell button:disabled"),
    true,
  );
  assert.equal(
    isComponentScopedSelector(
      ".rah-composer-pickers .rah-composer-picker:disabled",
    ),
    true,
  );
});

test("req6: the shipped report proves channel-extras reaches the composer picker", () => {
  const spec = loadComponentSpecs().find((item) => item.component === "sq-btn");
  const report = JSON.parse(readFileSync(spec.matchedRulesFile, "utf8"));
  const matched = report.probes["composer-picker-disabled"].map(
    (rule) => rule.selector,
  );
  assert.ok(
    matched.includes(".rah-composer-pickers .rah-composer-picker:disabled"),
    "the disabled picker rule must be visible to the element-based check",
  );
  // ...and it is now registered, with the upstream disabled state as source.
  const registered = spec.rules.find(
    (rule) =>
      rule.selector === ".rah-composer-pickers .rah-composer-picker:disabled",
  );
  assert.equal(registered.declarations.opacity, ".4");
  assert.equal(registered.declarations["pointer-events"], "none");
  assert.match(
    registered.source,
    /index-D8Neh8lc\.css \.btn-brutal-sm:disabled/u,
  );
});
