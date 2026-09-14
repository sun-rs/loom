// Contract for scripts/build-ui-catalog.mjs.
//
// The catalog is only useful if it is a projection of the committed sources.
// These tests hold that projection in place: every spec component and every
// pending id reaches the page, the token table lists every `:root` token, the
// upstream-expectation cells stay free of `var(` (comparing a RAH token with
// itself proves nothing, and a catalog that renders `var(--control-7)` as the
// upstream expectation would re-open exactly that hole), the page's own CSS
// spends only tokens, and two builds produce identical bytes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CHROME_CSS,
  STATIC_EXAMPLE_LABEL,
  buildCatalog,
  catalogStages,
  fixtureDigest as catalogFixtureDigest,
  loadFixtureMarkup,
  markupDriftErrors,
  parseBatchRules,
  escapeHtml,
  loadSpecs,
  parseCheckerConstraints,
  parseSkillSteps,
  parseTokens,
  productStyleOrder,
  renderMarkdown,
} from "./build-ui-catalog.mjs";

const html = buildCatalog();

// 767.98px is the product's own `md:` boundary (Raft's 768px breakpoint minus a
// hair, as apps/web/src/product.css and the sidebar-row spec both spell it) and
// tokens.brutal.css registers no breakpoint token, so a media query cannot be
// written in tokens. Nothing else in the page chrome may use a raw length.
const ALLOWED_RAW_PX = new Set(["767.98px"]);

test("every spec component is rendered with an anchor", () => {
  const specs = loadSpecs();
  assert.ok(specs.length > 0, "expected at least one committed spec");
  for (const spec of specs) {
    assert.ok(
      html.includes(`id="component-${spec.component}"`),
      `missing preview section for ${spec.component}`,
    );
    assert.ok(
      html.includes(`<h3>${escapeHtml(spec.component)}</h3>`),
      `missing heading for ${spec.component}`,
    );
  }
});

test("every pending id reaches the page", () => {
  for (const spec of loadSpecs()) {
    for (const entry of spec.pending ?? []) {
      assert.ok(
        html.includes(escapeHtml(entry.id)),
        `pending ${spec.component}/${entry.id} is not rendered`,
      );
    }
  }
});

test("every override is rendered, unresolved ones badged amber", () => {
  for (const spec of loadSpecs()) {
    for (const override of spec.overrides ?? []) {
      assert.ok(
        html.includes(escapeHtml(override.selector)),
        `override ${override.selector} is not rendered`,
      );
    }
    const unresolved = (spec.overrides ?? []).filter(
      (override) => override.status === "registered-unresolved",
    );
    if (unresolved.length > 0) {
      assert.ok(
        html.includes("uic-badge-amber"),
        "registered-unresolved overrides must be badged amber",
      );
    }
  }
});

test("the token table lists every :root custom property", () => {
  const tokens = parseTokens();
  assert.ok(tokens.length > 50, "expected the full token scale");
  for (const token of tokens) {
    assert.ok(
      html.includes(`<td>${escapeHtml(token.name)}</td>`),
      `token ${token.name} is missing a table row`,
    );
  }
});

test("upstream expectation cells never contain var()", () => {
  const cells = [...html.matchAll(/<td class="uic-expect">([\s\S]*?)<\/td>/gu)];
  assert.ok(cells.length > 0, "expected rendered expectation cells");
  for (const [, body] of cells) {
    assert.ok(
      !body.includes("var("),
      `expectation cell leaked a token: ${body}`,
    );
  }
});

test("the page's own CSS spends tokens, not raw lengths", () => {
  const found = [...CHROME_CSS.matchAll(/-?\d*\.?\d+px/gu)].map(
    (match) => match[0],
  );
  const unexpected = found.filter((value) => !ALLOWED_RAW_PX.has(value));
  assert.deepEqual(
    unexpected,
    [],
    `page chrome used raw lengths outside the allowlist: ${unexpected.join(", ")}`,
  );
});

test("the page is light-only and paints its own ground", () => {
  assert.ok(html.includes('<meta name="color-scheme" content="light">'));
  assert.ok(
    html.includes('<body style="background:var(--cream);color:var(--ink)">'),
  );
  assert.ok(!/prefers-color-scheme/u.test(CHROME_CSS));
});

test("the responsive branch uses the product breakpoint", () => {
  assert.ok(CHROME_CSS.includes("@media (max-width: 767.98px)"));
});

test("fonts and the icon sprite are inlined", () => {
  assert.ok(html.includes("data:font/woff2;base64,"), "fonts are not inlined");
  assert.ok(
    html.includes('id="raft-icon-plus"'),
    "the raft sprite is not inlined",
  );
  // The previews no longer reference the sprite by `<use>`: since owner review
  // finding 3 they render the fixture's own rendered DOM, which carries the
  // product's inline lucide SVG. That is a stronger statement than a sprite
  // reference the catalog wrote itself, so the sprite is kept for the page
  // chrome and the previews are asserted to carry real inline icons instead.
  assert.ok(
    /<svg viewBox="0 0 24 24"[^>]*>\s*<path/u.test(html),
    "previews carry no inline icon from the fixture DOM",
  );
});

test("stylesheets are inlined in the product's load order", () => {
  const order = productStyleOrder();
  let cursor = -1;
  for (const sheet of order) {
    const index = html.indexOf(`/* ===== ${sheet} ===== */`);
    assert.ok(index > 0, `${sheet} was not inlined`);
    assert.ok(index > cursor, `${sheet} is out of load order`);
    cursor = index;
  }
});

test("the skill steps and the six checker constraints are rendered", () => {
  const steps = parseSkillSteps(
    readFileSync(
      new URL("../.claude/skills/ui-component-spec/SKILL.md", import.meta.url),
      "utf8",
    ),
  );
  assert.ok(steps.length >= 8, "expected the full procedure");
  for (const step of steps) {
    assert.ok(
      html.includes(escapeHtml(step.title)),
      `step missing: ${step.title}`,
    );
  }
  const constraints = parseCheckerConstraints(
    readFileSync(new URL("./ui-component-spec.mjs", import.meta.url), "utf8"),
  );
  assert.equal(constraints.length, 6);
  for (const constraint of constraints) {
    assert.ok(
      html.includes(escapeHtml(constraint.text)),
      `constraint ${constraint.index} is not rendered`,
    );
  }
});

test("a missing source renders 未登记 instead of invented prose", () => {
  assert.ok(
    html.includes("未登记"),
    "expected at least one explicit gap marker",
  );
});

test("the markdown subset renders tables and code fences", () => {
  const rendered = renderMarkdown(
    "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```\nx\n```\n",
  );
  assert.ok(rendered.includes("<table"));
  assert.ok(rendered.includes('<pre class="uic-code">x</pre>'));
});

test("wide content scrolls inside its own container", () => {
  assert.ok(CHROME_CSS.includes(".uic-scroll { overflow-x: auto"));
  assert.ok(html.includes('class="uic-scroll'));
});

test("the build is deterministic", () => {
  assert.equal(buildCatalog(), html);
});

// Owner review 2026-09-12, finding 3 -----------------------------------------
//
// The previews used to be hand-written HTML in a PREVIEWS map, so a product
// JSX change never reached them and the page's "真实产品标记 / 没有一处手抄"
// claim was too strong. They now render the DOM the gate exported out of real
// Chrome, and the page says exactly that.

test("finding3: every preview stage's markup comes from the gate's export", () => {
  const specs = loadSpecs();
  assert.ok(specs.length > 0);
  for (const spec of specs) {
    const exported = loadFixtureMarkup(spec);
    assert.ok(exported !== undefined, `${spec.component} has no markup export`);
    for (const stage of catalogStages(spec)) {
      for (const probe of stage.probes) {
        const markup = exported.markup?.[probe]?.base;
        assert.equal(
          typeof markup,
          "string",
          `${spec.component}/${stage.label}: probe ${probe} is not in the export`,
        );
        assert.ok(
          html.includes(escapeHtml(markup).slice(0, 0) + markup),
          `${spec.component}/${stage.label}: rendered markup is not the exported DOM`,
        );
      }
    }
  }
});

test("finding3: the page no longer claims the previews are product markup", () => {
  assert.ok(!html.includes("预览是真实产品标记"));
  assert.ok(!html.includes("没有一处是手抄的"));
  assert.ok(html.includes("夹具在真实 Chrome 中的渲染快照，与门禁同源"));
  assert.ok(html.includes("夹具本身不是产品页面"));
});

test("finding3: a stage with no fixture counterpart is labelled, never silent", () => {
  const stages = catalogStages({ component: "demo" });
  assert.deepEqual(stages, []);
  assert.ok(
    STATIC_EXAMPLE_LABEL.includes("静态示例（非夹具）"),
    "a non-fixture stage must carry an explicit label",
  );
});

test("finding3: --check fails when a consumed markup file's fixture digest drifts", () => {
  const spec = {
    component: "demo",
    fixture: { html: "f.html", tsx: "f.tsx" },
    gateScript: "g.mjs",
    fixtureMarkupFile: "m.json",
  };
  const files = { "f.html": "<html>", "f.tsx": "a", "g.mjs": "b" };
  const read = (path) => files[path];
  const fresh = {
    fixtureSha256: catalogFixtureDigest(spec.fixture, read),
    gateScriptSha256: catalogFixtureDigest([spec.gateScript], read),
  };
  assert.deepEqual(
    markupDriftErrors([spec], read, () => fresh),
    [],
  );
  const drifted = { ...files, "f.tsx": "a-edited" };
  const errors = markupDriftErrors(
    [spec],
    (path) => drifted[path],
    () => fresh,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /m\.json was exported from fixtures hashing/u);
  assert.deepEqual(
    markupDriftErrors([spec], read, () => undefined),
    [
      "demo: m.json is missing; run node scripts/run-component-spec-browser-gate.mjs demo --report-matching-rules",
    ],
  );
});

test("finding3: the shipped markup exports are not drifted", () => {
  assert.deepEqual(markupDriftErrors(), []);
});

// Owner review 2026-09-12, finding 5 -----------------------------------------

test("finding5: message-row is listed as 待实施, never counted as finished", () => {
  assert.ok(
    html.includes("待实施"),
    "a doc-only component must be listed under 待实施",
  );
  assert.ok(html.includes("message-row"));
  const specs = loadSpecs();
  assert.ok(
    !specs.some((spec) => spec.component === "message-row"),
    "message-row has no spec JSON; it must not appear in the component count",
  );
  assert.ok(
    html.includes(`<dt>组件规格</dt><dd>${specs.length}</dd>`),
    "the hero count must be the spec count, not the doc count",
  );
});

// Owner review 2026-09-12, finding 4 -----------------------------------------

test("finding4: the rules section is parsed from SKILL.md, not hand-written", () => {
  const skill = readFileSync(
    new URL("../.claude/skills/ui-component-spec/SKILL.md", import.meta.url),
    "utf8",
  );
  const rules = parseBatchRules(skill);
  assert.ok(rules.length >= 8, "expected the batch rules to be parsed");
  for (const rule of rules)
    assert.ok(html.includes(escapeHtml(rule)), `rule missing: ${rule}`);
});

test("finding4: the tiered-verification wording reaches the page", () => {
  for (const phrase of ["本地验证", "同条件双边", "767", "1440×900", "390×844"])
    assert.ok(html.includes(escapeHtml(phrase)), `missing wording: ${phrase}`);
});
