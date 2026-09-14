// Component-spec checker for docs/design/component-specs/*.
//
// A component spec is the single machine-readable source for one visual
// component: which resolved declarations each selector+state must produce,
// which extra rules are registered overrides, and what is still pending. The
// four requirements it enforces come from the spec doc §自动检查要求:
//   1. every registered rule's resolved declarations equal the expected values;
//   2. every CSS rule whose selector mentions a component class is registered;
//   3. every registered entry carries `source` and `reason`;
//   4. `overrides` stays within the budget and a new override's `source`
//      points at evidence, so an exception can never be waved through by
//      widening a whitelist.
//
// Batch 2 (spec doc §批次 2：校验器加固) closes the three bypasses a reviewer
// reproduced against the batch-1 checker:
//   1. EXPECTATIONS ARE UPSTREAM LITERALS. `rules[].declarations` and
//      `browserExpectations` may not contain `var(`. Comparing a RAH token
//      against itself proves nothing, so the expectation names the upstream
//      value and the checker resolves RAH down to it. See
//      ./ui-component-spec-normalize.mjs for the canonical comparison form.
//   2. TOKEN VALUES ARE DERIVED. `tokenContract` states, per geometry token,
//      how upstream produces it (`--spacing * 7`, a lucide `size` attribute, a
//      named upstream custom property). The checker reads those constants out
//      of the frozen evidence CSS and recomputes the literal, so editing
//      `--control-7: 28px` to `99px` fails.
//   3. PROVENANCE IS COMPUTED, NOT DECLARED. sha256 of the evidence CSS/JS is
//      computed with node:crypto, and the `upstreamRules` the spec quotes are
//      re-parsed out of the evidence CSS and compared declaration by
//      declaration. Editing `cssSha256` to zeros fails.
//   4. THE BUDGET IS A COMMITTED RATCHET. Counts and budget live in
//      packages/ui-tokens/specs/ratchet.json and are compared against
//      `git show HEAD:` of that file. A working-tree bump is inert.
//   5. AN EXCEPTION MUST BE FALSIFIABLE. Every override and pending entry
//      carries `since` and `evidenceNeeded`.
//   6. COVERAGE IS BY ELEMENT, NOT BY CLASS-NAME TEXT. A committed
//      `*.matched-rules.json`, produced by the real-browser gate, lists every
//      rule that actually matches each fixture probe; any unregistered rule
//      touching a spec'd property fails. The report is invalidated by content
//      hash whenever the CSS inputs change.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cssContractInputs } from "./ui-css-contract.mjs";
import {
  normalizeLiteral,
  referencesVar,
} from "./ui-component-spec-normalize.mjs";

const SPEC_DIRECTORY = "packages/ui-tokens/specs";
const RATCHET_PATH = "packages/ui-tokens/specs/ratchet.json";
// The audited baseline a human reads before the initial ratchet commit.
export const BASELINE_DOC =
  "docs/design/component-specs/baseline-2026-09-12.zh-CN.md";

export { normalizeLiteral, referencesVar };

const uncomment = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "");

// Split a selector list on top-level commas only, so `:is(.a, .b)` survives.
function splitSelectorList(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const character of text) {
    if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts
    .map((part) => part.trim().replace(/\s+/gu, " "))
    .filter((part) => part.length > 0);
}

function parseDeclarations(body) {
  const declarations = {};
  let depth = 0;
  let current = "";
  const flush = () => {
    const text = current.trim();
    current = "";
    if (text.length === 0) return;
    const colon = text.indexOf(":");
    if (colon === -1) return;
    const property = text.slice(0, colon).trim();
    if (property.startsWith("--")) return;
    declarations[property] = text.slice(colon + 1).trim();
  };
  for (const character of body) {
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    if (character === ";" && depth === 0) {
      flush();
      continue;
    }
    current += character;
  }
  flush();
  return declarations;
}

/**
 * Flatten a stylesheet into `{ file, media, selector, declarations }` records,
 * one per individual selector, descending into @media / @supports blocks.
 */
export function parseCssRules(source, file = "") {
  const text = uncomment(source);
  const rules = [];
  const walk = (input, media) => {
    let index = 0;
    let prelude = "";
    while (index < input.length) {
      const character = input[index];
      if (character === "{") {
        let depth = 1;
        let end = index + 1;
        while (end < input.length && depth > 0) {
          if (input[end] === "{") depth += 1;
          else if (input[end] === "}") depth -= 1;
          end += 1;
        }
        const body = input.slice(index + 1, end - 1);
        const head = prelude.trim().replace(/\s+/gu, " ");
        if (head.startsWith("@")) {
          // Nested-rule at-rules recurse; declaration at-rules (@font-face,
          // @property, @keyframes) carry no selectors this checker owns.
          if (/^@(media|supports|layer|container)\b/u.test(head))
            walk(body, media === "" ? head : `${media} ${head}`);
        } else if (head.length > 0) {
          const declarations = parseDeclarations(body);
          // Custom properties are kept out of `declarations` (a spec entry
          // must not have to enumerate them) but are captured alongside, so
          // the upstream-evidence check can quote Tailwind's `--tw-shadow`
          // and `--tw-translate-*`, which is where upstream actually stores
          // the values the component's box-shadow and translate resolve to.
          const customProperties = Object.fromEntries(
            [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)(?:;|$)/gu)].map(
              (match) => [match[1], match[2].trim()],
            ),
          );
          // Each selector in a group gets its OWN declarations object. Sharing
          // one is not a saving but a soundness hole: componentSpecErrors
          // merges a repeated selector with `Object.assign(existing
          // .declarations, ...)`, and with a shared object that mutation also
          // lands on every sibling of the group. `.a, .b { x }` followed later
          // by `.b { y }` would make the checker believe `.a` declares `y`,
          // which then has to be asserted by the spec or reported as an
          // unregistered property. Observed on apps/web/src/product.css
          // `.rah-direct-room-fallback, .rah-direct-header-fallback`.
          for (const selector of splitSelectorList(head))
            rules.push({
              file,
              media,
              selector,
              declarations: { ...declarations },
              customProperties: { ...customProperties },
            });
        }
        prelude = "";
        index = end;
        continue;
      }
      if (character === "}") {
        prelude = "";
        index += 1;
        continue;
      }
      prelude += character;
      index += 1;
    }
  };
  walk(text, "");
  return rules;
}

/** Gather every custom-property definition across the given CSS inputs. */
export function collectTokens(inputs) {
  const tokens = new Map();
  for (const [path, source] of Object.entries(inputs)) {
    if (!path.endsWith(".css")) continue;
    for (const match of uncomment(source).matchAll(
      /(--[\w-]+)\s*:\s*([^;{}]+)[;}]/gu,
    ))
      if (!tokens.has(match[1])) tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

function expandVars(value, tokens, seen = new Set()) {
  let result = value;
  for (let pass = 0; pass < 20; pass += 1) {
    const start = result.indexOf("var(");
    if (start === -1) return result;
    let depth = 0;
    let end = start;
    while (end < result.length) {
      if (result[end] === "(") depth += 1;
      else if (result[end] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
      end += 1;
    }
    const inner = result.slice(start + 4, end);
    const comma = splitSelectorList(inner);
    const name = comma[0];
    const fallback = comma.slice(1).join(", ");
    let replacement;
    // Tailwind registers `--tw-shadow-color` and friends with `@property`
    // defaulting to `initial`; an `initial` custom property is treated as
    // unset, so the var()'s own fallback is what actually paints.
    const defined = tokens.has(name) && tokens.get(name).trim() !== "initial";
    if (!defined && fallback.length > 0) replacement = fallback;
    else if (tokens.has(name) && !seen.has(name))
      replacement = expandVars(
        tokens.get(name),
        tokens,
        new Set([...seen, name]),
      );
    else replacement = `«unresolved ${name}»`;
    result = result.slice(0, start) + replacement + result.slice(end + 1);
  }
  return result;
}

function evaluateCalc(value) {
  let result = value;
  for (let pass = 0; pass < 20; pass += 1) {
    const match = /calc\(([^()]*)\)/u.exec(result);
    if (match === null) return result;
    const expression = match[1];
    const units = [...expression.matchAll(/[\d.]+(px|rem|em|%)/gu)].map(
      (unit) => unit[1],
    );
    const unit = units[0] ?? "";
    if (units.some((candidate) => candidate !== unit))
      return result.replace(match[0], `«mixed-unit calc(${expression})»`);
    const bare = expression.replaceAll(unit, "");
    if (!/^[\d\s+\-*/.()]+$/u.test(bare))
      return result.replace(match[0], `«uncomputable calc(${expression})»`);
    // eslint-disable-next-line no-new-func -- arithmetic-only, unit-stripped.
    const computed = Function(`"use strict"; return (${bare});`)();
    result = result.replace(match[0], `${Number(computed.toFixed(4))}${unit}`);
  }
  return result;
}

/** Expand `var()` (including fallbacks) and fold `calc()` into a literal. */
export function resolveValue(value, tokens) {
  return evaluateCalc(expandVars(String(value).trim(), tokens))
    .replace(/\s+/gu, " ")
    .trim();
}

/** True when `selector` uses `className` as a whole class token. */
export function selectorMentions(selector, className) {
  const name = className.replace(/^\./u, "");
  return new RegExp(`\\.${name}(?![\\w-])`, "u").test(selector);
}

const registrationKey = (file, media, selector) =>
  `${file}||${media ?? ""}||${selector.replace(/\s+/gu, " ").trim()}`;

const EVIDENCE_SOURCE =
  /^(docs\/evidence\/|docs\/design\/component-specs\/|index-[\w-]+\.(css|js)@|main\.js@)/u;

// Properties this component owns. A rule that matches a probe element and
// declares one of these reshapes the component, so it must be registered.
export const SPEC_PROPERTIES = new Set([
  "width",
  "height",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border",
  "border-width",
  "border-style",
  "border-color",
  "box-shadow",
  "transform",
  "translate",
  "opacity",
  "pointer-events",
  "display",
  "background",
  "background-color",
  "font-family",
  "font-weight",
  "font-size",
  "cursor",
  "transition",
  "transition-property",
  "transition-duration",
  "transition-timing-function",
  "outline",
  "outline-width",
  "outline-style",
  "outline-offset",
  "flex",
]);

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

// ---------------------------------------------------------------------------
// Requirement 2: token values are derived from upstream, never asserted.
// ---------------------------------------------------------------------------

/**
 * Recompute one token's literal from its upstream derivation.
 * `upstream` is the custom-property table parsed out of the evidence CSS.
 */
export function deriveTokenLiteral(derivation, upstream) {
  const kind = derivation?.kind;
  if (kind === "literal") return String(derivation.value);
  if (kind === "upstream-var") {
    const value = upstream.get(derivation.name);
    if (value === undefined)
      return `«evidence CSS declares no ${derivation.name}»`;
    return value;
  }
  if (kind === "spacing-multiple") {
    const spacing = upstream.get(derivation.base ?? "--spacing");
    if (spacing === undefined)
      return `«evidence CSS declares no ${derivation.base ?? "--spacing"}»`;
    const match = /^(-?[\d.]+)(rem|px|em)$/u.exec(
      normalizeLiteral(spacing).replace(/\s/gu, ""),
    );
    if (match === null) return `«unparsable spacing ${spacing}»`;
    const root = derivation.rootFontSize ?? 16;
    const pixels =
      (match[2] === "rem" || match[2] === "em"
        ? Number(match[1]) * root
        : Number(match[1])) * Number(derivation.factor);
    return `${Number(pixels.toFixed(4))}px`;
  }
  if (kind === "sum") {
    let total = 0;
    for (const part of derivation.parts ?? []) {
      const literal = deriveTokenLiteral(part, upstream);
      const match = /^(-?[\d.]+)px$/u.exec(normalizeLiteral(literal));
      if (match === null) return `«non-px term ${literal}»`;
      total += Number(match[1]) * Number(part.times ?? 1);
    }
    return `${Number(total.toFixed(4))}px`;
  }
  return `«unknown derivation kind ${kind}»`;
}

/** Requirement 2: every geometry token must equal its upstream derivation. */
export function tokenContractErrors(spec, tokens, upstream) {
  const errors = [];
  for (const entry of spec.tokenContract ?? []) {
    const label = `${spec.component} tokenContract ${entry.token}`;
    if (typeof entry.source !== "string" || entry.source.length === 0)
      errors.push(`${label}: needs a source`);
    const declared = tokens.get(entry.token);
    if (declared === undefined) {
      errors.push(`${label}: the RAH stylesheets declare no such token`);
      continue;
    }
    const expected = deriveTokenLiteral(entry.derivation, upstream);
    const actual = resolveValue(declared, tokens);
    if (normalizeLiteral(actual) !== normalizeLiteral(expected))
      errors.push(
        `${label}: upstream derivation gives ${expected}, RAH declares ${actual}`,
      );
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Requirement 3: provenance is computed and the quoted upstream rules are
// re-parsed out of the evidence, so the spec can be falsified by the evidence.
// ---------------------------------------------------------------------------

/**
 * Hash the registered evidence files and re-check the quoted upstream rules
 * against the frozen CSS. `read` is injectable so tests need no fixtures.
 */
export function provenanceErrors(spec, read = (path) => readFileSync(path)) {
  const errors = [];
  const provenance = spec.provenance ?? {};
  const files = [
    ["cssFile", "cssSha256"],
    ["jsFile", "jsSha256"],
  ];
  let cssText;
  for (const [fileKey, hashKey] of files) {
    const path = provenance[fileKey];
    const expected = provenance[hashKey];
    if (typeof path !== "string" || path.length === 0) {
      errors.push(`${spec.component}: provenance.${fileKey} is missing`);
      continue;
    }
    if (typeof expected !== "string" || !/^[0-9a-f]{64}$/u.test(expected)) {
      errors.push(
        `${spec.component}: provenance.${hashKey} is not a sha256 digest`,
      );
      continue;
    }
    let bytes;
    try {
      bytes = read(path);
    } catch {
      errors.push(
        `${spec.component}: provenance.${fileKey} ${path} does not exist`,
      );
      continue;
    }
    const actual = sha256(bytes);
    if (actual !== expected)
      errors.push(
        `${spec.component}: provenance.${hashKey} says ${expected} but ${path} hashes to ${actual}`,
      );
    if (fileKey === "cssFile") cssText = String(bytes);
  }
  if (cssText === undefined) return errors;

  // Re-parse the evidence with the same walker used on RAH CSS, then confirm
  // each quoted upstream rule exists with the declarations the spec quotes.
  const evidenceRules = new Map();
  for (const rule of parseCssRules(cssText, provenance.cssFile)) {
    const key = `${rule.media}||${rule.selector}`;
    const merged = { ...rule.declarations, ...rule.customProperties };
    const existing = evidenceRules.get(key);
    if (existing === undefined) evidenceRules.set(key, merged);
    else Object.assign(existing, merged);
  }
  const upstream = collectTokens({ [`${provenance.cssFile}`]: cssText });
  for (const entry of spec.upstreamRules ?? []) {
    const label = `${spec.component} upstreamRules ${entry.selector}`;
    const found = evidenceRules.get(`${entry.media ?? ""}||${entry.selector}`);
    if (found === undefined) {
      errors.push(`${label}: not present in ${provenance.cssFile}`);
      continue;
    }
    for (const [property, quoted] of Object.entries(entry.declarations ?? {})) {
      const actual = found[property];
      if (actual === undefined) {
        errors.push(`${label}: ${property} is not declared upstream`);
        continue;
      }
      // Upstream writes its own theme vars; expand them with the evidence
      // CSS's own :root so the quoted value can be a literal.
      const resolved = resolveValue(actual, upstream);
      if (normalizeLiteral(resolved) !== normalizeLiteral(quoted))
        errors.push(
          `${label}: ${property} quoted as ${quoted}, evidence says ${resolved}`,
        );
    }
  }
  return errors;
}

/** Parse the evidence CSS's own custom properties, for tokenContract. */
export function upstreamThemeTokens(cssText, path = "evidence.css") {
  return collectTokens({ [path]: cssText });
}

// ---------------------------------------------------------------------------
// Requirement 4: the budget is a committed ratchet, readable only from HEAD.
// ---------------------------------------------------------------------------

/** Read `packages/ui-tokens/specs/ratchet.json` as committed at HEAD. */
export function committedRatchet(path = RATCHET_PATH) {
  try {
    const text = execFileSync("git", ["show", `HEAD:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { present: true, value: JSON.parse(text) };
  } catch {
    return { present: false, value: {} };
  }
}

/**
 * Requirement 4. Working-tree counts and the working-tree budget must all be
 * at or below what HEAD committed. A missing HEAD version means every
 * committed value is 0, which is a hard failure until a human commits the
 * ratchet — exactly the "first registration starts at zero" path in the doc.
 */
export function ratchetErrors(component, counts, working, committed) {
  const errors = [];
  const head = committed.present ? (committed.value?.[component] ?? {}) : {};
  const zeroed =
    !committed.present || committed.value?.[component] === undefined;
  const at = (key) => Number(head[key] ?? 0);
  if (working === undefined) {
    errors.push(
      `${component}: ${RATCHET_PATH} has no entry; register the component with a zero ratchet first`,
    );
    return errors;
  }
  if (zeroed)
    errors.push(
      `${component}: ${RATCHET_PATH} is not committed at HEAD, so every committed value counts as 0; review the audited baseline in ${BASELINE_DOC} and commit ${RATCHET_PATH} before it can hold anything back (${"--uncommitted-ratchet-preview"} previews the run, it does not replace the commit)`,
    );
  // The working-tree ratchet may only ever move down.
  for (const key of ["overrides", "pending", "overrideBudget"]) {
    const declared = Number(working[key] ?? 0);
    if (declared > at(key))
      errors.push(
        `${component}: working-tree ${key} ratchet rose to ${declared}; lower it instead of raising the committed ${at(key)} ratchet`,
      );
  }
  if (counts.overrides > Number(working.overrideBudget ?? 0))
    errors.push(
      `${component}: ${counts.overrides} overrides exceed the ${working.overrideBudget ?? 0} overrideBudget`,
    );
  if (counts.overrides > at("overrides"))
    errors.push(
      `${component}: overrides rose to ${counts.overrides}; close an exception instead of raising the committed ${at("overrides")} ratchet`,
    );
  if (counts.pending > at("pending"))
    errors.push(
      `${component}: pending questions rose to ${counts.pending}; answer one instead of raising the committed ${at("pending")} ratchet`,
    );
  return errors;
}

// ---------------------------------------------------------------------------
// Requirement 6: coverage by element, from the browser-produced report.
// ---------------------------------------------------------------------------

/**
 * True when a selector is specific enough to be this component's business.
 * See the comment at its call site for why `:where()` is stripped first.
 *
 * KNOWN LIMITATION: a zero-specificity `:where()` default can still reach the
 * component for a property the component itself never declares (font-size
 * today). Those live in the reset layer and are tracked there, not here.
 */
export function isComponentScopedSelector(selector) {
  let stripped = selector;
  for (let pass = 0; pass < 10; pass += 1) {
    const next = stripped.replace(/:where\([^()]*\)/gu, "");
    if (next === stripped) break;
    stripped = next;
  }
  return /[.#[]/u.test(stripped);
}

/** Content hash of the CSS inputs a matched-rules report was produced from. */
export function cssInputsDigest(inputs) {
  const hash = createHash("sha256");
  for (const path of Object.keys(inputs).sort()) {
    if (!path.endsWith(".css")) continue;
    hash.update(path);
    hash.update("\0");
    hash.update(inputs[path]);
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Content hash of a set of files, by path and bytes. Used to bind a
 * browser-produced report to the fixture that produced it and to the gate
 * program that read it: CSS alone is not enough, because the fixture's JSX
 * decides which elements exist and the gate decides what is read from them.
 *
 * Accepts either an array of paths or a `{key: path}` map (spec.fixture).
 */
export function fixtureDigest(files, read = readFileSync) {
  const paths = (Array.isArray(files) ? files : Object.values(files ?? {}))
    .filter((path) => typeof path === "string")
    .sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(read(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Requirement 7. Bind a browser-produced report to the fixture files, to the
 * gate program, and to the rendered DOM the gate exported. The static checker
 * cannot render anything, so the DOM half is held by comparing the report's
 * `structureSha256` against the digest recorded in the exported markup file —
 * which the gate writes in the same run, from the same DOM.
 */
function reportBindingErrors(spec, report, read, options = {}) {
  const errors = [];
  const name = spec.component;
  if (spec.fixture !== undefined) {
    let expected;
    try {
      expected = fixtureDigest(spec.fixture, read);
    } catch (error) {
      errors.push(`${name}: fixture files are unreadable (${error.message})`);
    }
    if (expected !== undefined && report.fixtureSha256 !== expected)
      errors.push(
        `${name}: the matched-rules report was produced from fixtures hashing ${report.fixtureSha256 ?? "(absent)"}, the fixture files now hash to ${expected}; re-run the browser gate with --report-matching-rules`,
      );
  }
  if (spec.gateScript !== undefined) {
    let expected;
    try {
      expected = fixtureDigest([spec.gateScript], read);
    } catch (error) {
      errors.push(`${name}: gate script is unreadable (${error.message})`);
    }
    if (expected !== undefined && report.gateScriptSha256 !== expected)
      errors.push(
        `${name}: the matched-rules report was produced by a gate hashing ${report.gateScriptSha256 ?? "(absent)"}, the gate script now hashes to ${expected}; re-run the browser gate with --report-matching-rules`,
      );
  }
  if (spec.fixtureMarkupFile === undefined) return errors;
  const markup =
    "fixtureMarkup" in options
      ? options.fixtureMarkup
      : readJsonIfPresent(spec.fixtureMarkupFile);
  if (markup === undefined) {
    errors.push(
      `${name}: ${spec.fixtureMarkupFile} is missing; run node scripts/run-component-spec-browser-gate.mjs ${name} --report-matching-rules`,
    );
    return errors;
  }
  if (
    typeof report.structureSha256 !== "string" ||
    report.structureSha256 !== markup.structureSha256
  )
    errors.push(
      `${name}: the rendered fixture DOM digest in the report (${report.structureSha256 ?? "(absent)"}) does not match ${spec.fixtureMarkupFile} (${markup.structureSha256 ?? "(absent)"}); re-run the browser gate with --report-matching-rules`,
    );
  for (const id of captureProbeIds(spec))
    if ((markup.markup ?? {})[id] === undefined)
      errors.push(
        `${name}: ${spec.fixtureMarkupFile} is missing rendered markup for probe "${id}"`,
      );
  return errors;
}

/** The probe ids a matched-rules report must carry, from the spec. */
export function coverageProbeIds(spec) {
  return (spec.probes ?? [])
    .filter((probe) => probe.coverage !== false)
    .map((probe) => probe.id);
}

/** The probe ids whose rendered markup the gate must export. */
export function captureProbeIds(spec) {
  return (spec.probes ?? [])
    .filter((probe) => probe.capture !== false)
    .map((probe) => probe.id);
}

/**
 * Requirement 6. For each fixture probe the browser reported every rule that
 * actually matches the element; anything unregistered that touches a property
 * this component owns is a bypass of the class-name-text registration.
 *
 * Requirement 7 (owner review 2026-09-12) closes the coverage bypass: the
 * report used to bind only the CSS and to carry whatever probes the browser
 * happened to find, so an EMPTY `probes` map with a correct `cssInputsSha256`
 * passed with zero errors and a fixture JSX edit kept an old report valid. The
 * probe list now lives in the spec and the report is bound to four things:
 * the CSS inputs, the fixture files, the rendered fixture DOM, and the gate
 * program itself.
 */
export function matchedRulesErrors(
  spec,
  inputs,
  report,
  registered,
  parsedRules = [],
  options = {},
) {
  const errors = [];
  if (report === undefined) {
    errors.push(
      `${spec.component}: ${spec.matchedRulesFile ?? "matched-rules report"} is missing; run node scripts/run-component-spec-browser-gate.mjs ${spec.component} --report-matching-rules`,
    );
    return errors;
  }
  const read = options.readFile ?? ((path) => readFileSync(path));
  const digest = cssInputsDigest(inputs);
  if (report.cssInputsSha256 !== digest)
    errors.push(
      `${spec.component}: the matched-rules report was produced from CSS hashing ${report.cssInputsSha256}, the tree now hashes to ${digest}; re-run the browser gate with --report-matching-rules`,
    );
  errors.push(...reportBindingErrors(spec, report, read, options));
  // Requirement 7: no skipping. Every declared probe must be present, and the
  // report may not smuggle in a probe the spec never declared.
  if (Array.isArray(spec.probes)) {
    const declared = new Set(coverageProbeIds(spec));
    const reported = new Set(Object.keys(report.probes ?? {}));
    for (const id of [...declared].sort())
      if (!reported.has(id))
        errors.push(
          `${spec.component}: the matched-rules report is missing probe "${id}"; every probe declared in the spec must be reported (no skipping)`,
        );
    for (const id of [...reported].sort())
      if (!declared.has(id))
        errors.push(
          `${spec.component}: the matched-rules report carries probe "${id}", which the spec does not declare; declare it in spec.probes or regenerate the report`,
        );
  }
  // The browser sees one bundled stylesheet, so a matched selector is
  // attributed back to its source file by looking it up in the statically
  // parsed CSS. That is also the only file path a registration can name.
  const filesBySelector = new Map();
  for (const rule of parsedRules) {
    const selector = rule.selector.replace(/\s+/gu, " ").trim();
    const bucket = filesBySelector.get(selector) ?? [];
    bucket.push(rule);
    filesBySelector.set(selector, bucket);
  }
  for (const [probe, matched] of Object.entries(report.probes ?? {}))
    for (const rule of matched) {
      const selector = String(rule.selector).replace(/\s+/gu, " ").trim();
      // Type-level defaults are not component-scoped. Strip every `:where()`
      // group — the author writes those precisely to contribute no specificity
      // — and if nothing with a class, id or attribute is left, the selector is
      // an element default (`*`, `button`, `:where(.shell) :where(button)`)
      // owned by the reset layer rather than by this component's spec. A rule
      // that keeps a real class anywhere (`.rah-product-shell button:disabled`)
      // is still this component's business and must be registered.
      if (!isComponentScopedSelector(selector)) continue;
      const touched = (rule.properties ?? []).filter((property) =>
        SPEC_PROPERTIES.has(property),
      );
      if (touched.length === 0) continue;
      const candidates = filesBySelector.get(selector) ?? [];
      if (candidates.length === 0) {
        errors.push(
          `${spec.component}: rule "${selector}" matches the "${probe}" fixture element but no source stylesheet declares it; the matched-rules report is out of step with the tree`,
        );
        continue;
      }
      const unregistered = candidates.filter(
        (candidate) =>
          !registered.has(
            registrationKey(candidate.file, candidate.media, selector),
          ),
      );
      if (unregistered.length === 0) continue;
      for (const candidate of unregistered)
        errors.push(
          `${spec.component}: unregistered rule ${candidate.file} ${selector} matches the "${probe}" fixture element and sets ${touched.sort().join(", ")} — register it in rules or overrides with source and reason`,
        );
    }
  return errors;
}

/**
 * Check one component spec against the parsed stylesheets. Returns a sorted
 * list of human-readable failures; an empty list means the component matches.
 */
export function componentSpecErrors(spec, inputs, options = {}) {
  const tokens = collectTokens(inputs);
  const rules = Object.entries(inputs)
    .filter(([path]) => path.endsWith(".css"))
    .flatMap(([path, source]) => parseCssRules(source, path));
  const byKey = new Map();
  for (const rule of rules) {
    const key = registrationKey(rule.file, rule.media, rule.selector);
    const existing = byKey.get(key);
    if (existing === undefined) byKey.set(key, rule);
    // A repeated selector in the same file is a later cascade winner for the
    // properties it repeats; merge so the spec asserts the effective value.
    else Object.assign(existing.declarations, rule.declarations);
  }
  const errors = [];
  const registered = new Set();
  const entries = [
    ...(spec.rules ?? []).map((entry) => ({ entry, kind: "rules" })),
    ...(spec.overrides ?? []).map((entry) => ({ entry, kind: "overrides" })),
  ];

  for (const { entry, kind } of entries) {
    const label = `${spec.component} ${entry.file} ${entry.selector}`;
    const key = registrationKey(entry.file, entry.media, entry.selector);
    registered.add(key);
    if (typeof entry.source !== "string" || entry.source.length === 0)
      errors.push(`${label}: ${kind} entry needs a source`);
    if (typeof entry.reason !== "string" || entry.reason.length === 0)
      errors.push(`${label}: ${kind} entry needs a reason`);
    // An override that claims upstream backing must cite evidence. An override
    // explicitly marked REGISTERED-UNRESOLVED has, by definition, no upstream
    // evidence yet; it must instead name a `pending` question so the exception
    // stays visible rather than becoming a permanent whitelist entry.
    if (kind === "overrides" && entry.status === "registered-unresolved") {
      const pending = (spec.pending ?? []).map((item) => item.id);
      if (!pending.includes(entry.pending))
        errors.push(
          `${label}: REGISTERED-UNRESOLVED override must name a pending id, got "${entry.pending}"`,
        );
    } else if (
      kind === "overrides" &&
      typeof entry.source === "string" &&
      entry.source.length > 0 &&
      !EVIDENCE_SOURCE.test(entry.source)
    )
      errors.push(
        `${label}: override source must point at docs/evidence/ or an upstream bundle offset, got "${entry.source}"`,
      );
    const declarations = entry.declarations ?? {};
    if (Object.keys(declarations).length === 0) continue;
    const rule = byKey.get(key);
    const state = entry.state ?? "—";
    if (rule === undefined) {
      errors.push(`${label} [${state}]: no such rule in the parsed CSS`);
      continue;
    }
    for (const [property, expected] of Object.entries(declarations)) {
      // Requirement 1: an expectation that itself says `var(--control-7)` is
      // satisfied by any value the token happens to hold, so it asserts
      // nothing. Only an upstream literal is an expectation.
      if (referencesVar(expected)) {
        errors.push(
          `${label} [${state}]: ${property} expectation "${expected}" references a RAH token; write the upstream literal instead`,
        );
        continue;
      }
      const declared = rule.declarations[property];
      if (declared === undefined) {
        errors.push(`${label} [${state}]: ${property} is not declared`);
        continue;
      }
      const resolved = resolveValue(declared, tokens);
      if (normalizeLiteral(resolved) !== normalizeLiteral(expected))
        errors.push(
          `${label} [${state}]: ${property} expected ${expected}, resolved ${resolved}`,
        );
    }
    for (const property of Object.keys(rule.declarations))
      if (
        entry.allowExtraDeclarations !== true &&
        declarations[property] === undefined
      )
        errors.push(
          `${label} [${state}]: ${property} is declared but not in the spec`,
        );
  }

  const classNames = spec.classNames ?? [];
  for (const rule of byKey.values()) {
    if (!classNames.some((name) => selectorMentions(rule.selector, name)))
      continue;
    const key = registrationKey(rule.file, rule.media, rule.selector);
    if (registered.has(key)) continue;
    errors.push(
      `${spec.component}: unregistered rule ${rule.file} ${rule.selector} — add it to rules or overrides with source and reason`,
    );
  }

  // Requirement 1, second half: a browser expectation may not name a RAH token
  // either — the gate reads a computed style, so only a literal makes sense.
  for (const [key, expected] of Object.entries(spec.browserExpectations ?? {}))
    if (referencesVar(expected))
      errors.push(
        `${spec.component}: browserExpectation ${key} "${expected}" references a RAH token; write the literal the browser computes`,
      );

  // Requirement 5: an exception nobody can ever close is a whitelist entry
  // wearing a reason. Every override and pending must say what would close it
  // and when it was opened.
  const pendingIds = new Set();
  for (const item of spec.pending ?? []) {
    const label = `${spec.component} pending ${item.id}`;
    if (pendingIds.has(item.id)) errors.push(`${label}: duplicate pending id`);
    pendingIds.add(item.id);
    for (const field of ["since", "evidenceNeeded"])
      if (typeof item[field] !== "string" || item[field].length === 0)
        errors.push(`${label}: needs ${field}`);
  }
  for (const entry of spec.overrides ?? []) {
    const label = `${spec.component} ${entry.file} ${entry.selector}`;
    for (const field of ["since", "evidenceNeeded"])
      if (typeof entry[field] !== "string" || entry[field].length === 0)
        errors.push(`${label}: override needs ${field}`);
  }

  // Requirements 2 and 3 both need the frozen evidence, so read it once.
  const readEvidence = options.readEvidence ?? ((path) => readFileSync(path));
  if (spec.provenance !== undefined)
    errors.push(...provenanceErrors(spec, readEvidence));
  if ((spec.tokenContract ?? []).length > 0) {
    let upstream = new Map();
    try {
      upstream = upstreamThemeTokens(
        String(readEvidence(spec.provenance?.cssFile)),
        spec.provenance?.cssFile,
      );
    } catch {
      errors.push(
        `${spec.component}: tokenContract cannot be checked without the evidence CSS`,
      );
    }
    errors.push(...tokenContractErrors(spec, tokens, upstream));
  }

  // Requirement 6: element-based coverage from the committed browser report.
  if (spec.matchedRulesFile !== undefined && options.skipMatchedRules !== true)
    errors.push(
      ...matchedRulesErrors(
        spec,
        inputs,
        options.matchedRules ?? readJsonIfPresent(spec.matchedRulesFile),
        registered,
        [...byKey.values()],
        options,
      ),
    );

  // Requirement 4: the budget is a committed ratchet, not a spec field.
  if (spec.overrideBudget !== undefined)
    errors.push(
      `${spec.component}: overrideBudget moved to ${RATCHET_PATH}; remove it from the spec`,
    );
  if (options.skipRatchet !== true) {
    const working =
      options.workingRatchet ??
      (readJsonIfPresent(RATCHET_PATH) ?? {})[spec.component];
    errors.push(
      ...ratchetErrors(
        spec.component,
        {
          overrides: (spec.overrides ?? []).length,
          pending: pendingIds.size,
        },
        working,
        options.committedRatchet ?? committedRatchet(),
      ),
    );
  }

  return [...new Set(errors)].sort();
}

const readJsonIfPresent = (path) =>
  existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;

/** Load every `*.spec.json` under packages/ui-tokens/specs. */
export function loadComponentSpecs(directory = SPEC_DIRECTORY) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".spec.json"))
    .sort()
    .map((name) =>
      JSON.parse(
        readFileSync(relative(process.cwd(), resolve(directory, name)), "utf8"),
      ),
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const specs = loadComponentSpecs();
  const inputs = cssContractInputs();
  // `--uncommitted-ratchet-preview` (owner review 2026-09-12, finding 2:
  // renamed from `--allow-uncommitted-ratchet`, because "allow" reads like a
  // sanctioned mode) exists for the one local report run a human makes while
  // reviewing the baseline package before committing
  // packages/ui-tokens/specs/ratchet.json. It must never appear in
  // package.json: in CI the uncommitted ratchet IS the failure, because an
  // uncommitted budget holds nothing back. It is not the long-term answer —
  // BASELINE_DOC is.
  const preview = process.argv.includes("--uncommitted-ratchet-preview");
  const committed = committedRatchet();
  const effective =
    preview && !committed.present
      ? { present: true, value: readJsonIfPresent(RATCHET_PATH) ?? {} }
      : committed;
  if (preview && !committed.present)
    process.stderr.write(
      `WARNING: --uncommitted-ratchet-preview is treating the working-tree ${RATCHET_PATH} as committed, which holds nothing back. This is a preview, not a mode: review ${BASELINE_DOC} and commit ${RATCHET_PATH}.\n`,
    );
  const errors = specs.flatMap((spec) =>
    componentSpecErrors(spec, inputs, { committedRatchet: effective }),
  );
  if (errors.length) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exitCode = 1;
  } else
    process.stdout.write(
      `Component specs hold: ${specs.map((spec) => spec.component).join(", ")}\n`,
    );
}
