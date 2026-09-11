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
  buildCatalog,
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
    assert.ok(!body.includes("var("), `expectation cell leaked a token: ${body}`);
  }
});

test("the page's own CSS spends tokens, not raw lengths", () => {
  const found = [...CHROME_CSS.matchAll(/-?\d*\.?\d+px/gu)].map((match) => match[0]);
  const unexpected = found.filter((value) => !ALLOWED_RAW_PX.has(value));
  assert.deepEqual(
    unexpected,
    [],
    `page chrome used raw lengths outside the allowlist: ${unexpected.join(", ")}`,
  );
});

test("the page is light-only and paints its own ground", () => {
  assert.ok(html.includes('<meta name="color-scheme" content="light">'));
  assert.ok(html.includes('<body style="background:var(--cream);color:var(--ink)">'));
  assert.ok(!/prefers-color-scheme/u.test(CHROME_CSS));
});

test("the responsive branch uses the product breakpoint", () => {
  assert.ok(CHROME_CSS.includes("@media (max-width: 767.98px)"));
});

test("fonts and the icon sprite are inlined", () => {
  assert.ok(html.includes("data:font/woff2;base64,"), "fonts are not inlined");
  assert.ok(html.includes('id="raft-icon-plus"'), "the raft sprite is not inlined");
  assert.ok(html.includes('href="#raft-icon-plus"'), "no preview uses the sprite");
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
    assert.ok(html.includes(escapeHtml(step.title)), `step missing: ${step.title}`);
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
  assert.ok(html.includes("未登记"), "expected at least one explicit gap marker");
});

test("the markdown subset renders tables and code fences", () => {
  const rendered = renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```\nx\n```\n");
  assert.ok(rendered.includes("<table"));
  assert.ok(rendered.includes("<pre class=\"uic-code\">x</pre>"));
});

test("wide content scrolls inside its own container", () => {
  assert.ok(CHROME_CSS.includes(".uic-scroll { overflow-x: auto"));
  assert.ok(html.includes('class="uic-scroll'));
});

test("the build is deterministic", () => {
  assert.equal(buildCatalog(), html);
});
