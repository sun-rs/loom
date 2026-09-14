// Real-Chrome computed-style gate for every component spec, driven by the
// spec JSON rather than by a per-component copy of this program.
//
//   node scripts/run-component-spec-browser-gate.mjs <component> --write-baseline <path>
//   node scripts/run-component-spec-browser-gate.mjs <component> --compare <path>
//   node scripts/run-component-spec-browser-gate.mjs <component> --expect-spec
//   node scripts/run-component-spec-browser-gate.mjs <component> --report-matching-rules
//
// It replaces scripts/run-{sq-btn,sidebar-row}-spec-browser-gate.mjs, which
// were three near-identical copies. Everything that differed between them —
// probe table, viewports, read properties, settle time, fixture URL — now
// lives in `packages/ui-tokens/specs/<component>.spec.json` under `probes` and
// `gate`, which is also what the static checker reads, so the gate and the
// checker can no longer disagree about which probes exist.
//
// OWNER REVIEW 2026-09-12, finding 1 (coverage bypass). Two changes:
//   * A probe declared in the spec but absent from the fixture is a HARD
//     FAILURE. The old gate did `if (element === null) continue`, so deleting
//     a probe from the fixture silently shrank coverage to nothing.
//   * The report binds four things, not one: the CSS inputs, the fixture
//     files (html + tsx bytes), the rendered fixture DOM of every probe, and
//     this program's own bytes. Changing any of them invalidates the report.
//
// Finding 3. `--report-matching-rules` also exports the rendered fixture DOM
// to `packages/ui-tokens/specs/<component>.fixture-markup.json`, which is what
// docs/design/ui-catalog.html renders. Catalog previews and the gate therefore
// read the same DOM; nothing in the catalog is hand-copied component markup.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { createServer } from "vite";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";

const argv = process.argv.slice(2);
const flag = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};
const component = argv.find((value) => !value.startsWith("--"));
if (component === undefined) {
  process.stderr.write(
    "usage: node scripts/run-component-spec-browser-gate.mjs <component> [--write-baseline <path>] [--compare <path>] [--expect-spec] [--report-matching-rules]\n",
  );
  process.exit(2);
}

const SPEC_PATH = `packages/ui-tokens/specs/${component}.spec.json`;
const spec = JSON.parse(readFileSync(resolve(SPEC_PATH), "utf8"));
const GATE_SCRIPT = "scripts/run-component-spec-browser-gate.mjs";
if (spec.gateScript !== undefined && spec.gateScript !== GATE_SCRIPT) {
  process.stderr.write(
    `${component}: spec.gateScript says ${spec.gateScript}, this program is ${GATE_SCRIPT}\n`,
  );
  process.exit(2);
}

const writeBaseline = flag("--write-baseline");
const comparePath = flag("--compare");
const expectSpec = argv.includes("--expect-spec");
const reportMatchingRules = argv.includes("--report-matching-rules");

const gate = spec.gate ?? {};
// Longhands only, so a shorthand rewrite can never hide a value change behind
// a different serialization.
const PROPERTIES = gate.properties ?? [];
const PROBES = spec.probes ?? [];
const CAPTURE_PROBES = PROBES.filter((probe) => probe.capture !== false);
const MATCH_PROBES = PROBES.filter((probe) => probe.coverage !== false);
const VIEWPORTS = (gate.viewports ?? []).map(([width, height]) => ({
  width,
  height,
}));
const FIXTURE_URL = gate.fixtureUrl;
const ANCHOR = gate.anchorProbe ?? CAPTURE_PROBES[0]?.id;
// Components transition over 100–150ms. Reading before the transition lands
// captures interpolated garbage (0.339px shadows), which makes --compare
// unstable, so every state read waits out the transition plus two frames.
const settle = (page) => page.waitForTimeout(gate.settleMs ?? 320);
const SKIP_ZERO_WIDTH = gate.skipZeroWidth === true;

if (PROBES.length === 0 || VIEWPORTS.length === 0 || FIXTURE_URL === undefined)
  throw new Error(
    `${component}: ${SPEC_PATH} must declare probes and gate.{fixtureUrl,viewports,properties}`,
  );

// Generated JSON is committed, so it must satisfy `npm run format:check`.
// Formatting it here (rather than asking a human to remember `prettier --write`
// after every gate run) keeps regeneration idempotent.
const formatJson = async (value) => {
  const prettier = await import("prettier");
  const text = `${JSON.stringify(value, null, 2)}\n`;
  return prettier.format(text, { parser: "json" });
};

const fileDigest = (paths) => {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(resolve(path)));
    hash.update("\0");
  }
  return hash.digest("hex");
};

async function withFixture(viewport, run) {
  const server = await createServer({
    root: new URL("../apps/web", import.meta.url).pathname,
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, "");
  const browser = await chromium.launch({
    executablePath: await findChromeExecutable(),
    headless: true,
  });
  try {
    return await run({ browser, origin });
  } finally {
    await browser.close();
    await server.close();
  }
}

/**
 * Finding 1: no skipping. Every declared probe must exist in the fixture, at
 * every viewport. A missing probe is what silently shrank coverage before.
 */
async function assertEveryProbePresent(page, probes, where) {
  const missing = await page.evaluate(
    (ids) =>
      ids.filter(
        (id) => document.querySelector(`[data-probe="${id}"]`) === null,
      ),
    probes.map((probe) => probe.id),
  );
  if (missing.length)
    throw new Error(
      `${component}: ${missing.length} declared probe(s) absent from the fixture at ${where}: ${missing.join(", ")}. Add them to the fixture or remove them from ${SPEC_PATH} probes — the gate does not skip.`,
    );
}

const readProbe = async (page, probe) =>
  page.evaluate(
    ([selector, properties]) => {
      const element = document.querySelector(selector);
      if (element === null) throw new Error(`probe missing: ${selector}`);
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      const svg = element.querySelector("svg");
      const record = Object.fromEntries(
        properties.map((property) => [
          property,
          style.getPropertyValue(property),
        ]),
      );
      record.display = style.display;
      record["client-width"] = String(box.width);
      record["client-height"] = String(box.height);
      record["svg-width"] = svg === null ? "none" : getComputedStyle(svg).width;
      record["svg-height"] =
        svg === null ? "none" : getComputedStyle(svg).height;
      return record;
    },
    [`[data-probe="${probe}"]`, PROPERTIES],
  );

async function openFixture(browser, origin, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto(`${origin}${FIXTURE_URL}`);
  // `attached`, not `visible`: a hidden responsive branch legitimately has a
  // zero box, and waiting for visibility there would time out instead of
  // recording the fact.
  await page.locator(`[data-probe="${ANCHOR}"]`).waitFor({ state: "attached" });
  // Fonts must settle or font-family/font-weight read mid-swap.
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function capture() {
  return withFixture(undefined, async ({ browser, origin }) => {
    const captured = {};
    for (const viewport of VIEWPORTS) {
      const page = await openFixture(browser, origin, viewport);
      await assertEveryProbePresent(
        page,
        PROBES,
        `${viewport.width}x${viewport.height}`,
      );
      for (const declared of CAPTURE_PROBES) {
        const probe = declared.id;
        const key = `${viewport.width}x${viewport.height}/${probe}`;
        const locator = page.locator(`[data-probe="${probe}"]`);
        const states = {};
        // Park the mouse away from every probe before the base read.
        await page.mouse.move(5, 5);
        await settle(page);
        states.base = await readProbe(page, probe);
        // A probe with no box is either display:none itself or inside an
        // ancestor that is. Recording the base row still proves *that* it is
        // not rendered, which is what the narrow-viewport question needs; it
        // has no interactive states to read.
        if (
          states.base.display === "none" ||
          (SKIP_ZERO_WIDTH && states.base["client-width"] === "0")
        ) {
          captured[key] = states;
          continue;
        }
        if (declared.disabled === true) {
          // A disabled control has no hover/active/focus-visible of its own;
          // the disabled read IS the state the spec constrains.
          states.disabled = states.base;
        } else if (declared.interactive !== false) {
          await locator.hover();
          await settle(page);
          states.hover = await readProbe(page, probe);
          const box = await locator.boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await settle(page);
          states.active = await readProbe(page, probe);
          await page.mouse.up();
          await page.mouse.move(5, 5);
          await settle(page);
          // Keyboard focus so :focus-visible actually matches (a click focus
          // does not, which is the whole point of reading it via Tab).
          await page.evaluate(() => {
            document.activeElement?.blur?.();
          });
          await page.evaluate((target) => {
            const node = document.querySelector(`[data-probe="${target}"]`);
            const previous = document.createElement("button");
            previous.id = "component-spec-focus-seed";
            node.parentElement.insertBefore(previous, node);
            previous.focus();
          }, probe);
          await page.keyboard.press("Tab");
          await settle(page);
          states["focus-visible"] = await readProbe(page, probe);
          states["focus-visible"]["matches-focus-visible"] = String(
            await page.evaluate(
              (target) =>
                document
                  .querySelector(`[data-probe="${target}"]`)
                  .matches(":focus-visible"),
              probe,
            ),
          );
          await page.evaluate(() => {
            document.getElementById("component-spec-focus-seed")?.remove();
            document.activeElement?.blur();
          });
        } else if (typeof declared.hoverHost === "string") {
          // A non-interactive probe revealed by an ancestor's hover (a compact
          // row's timestamp under `group-hover/message`) is read while that
          // ancestor is hovered.
          await page.locator(`[data-probe="${declared.hoverHost}"]`).hover();
          await settle(page);
          states["host-hover"] = await readProbe(page, probe);
          await page.mouse.move(5, 5);
          await settle(page);
        }
        captured[key] = states;
      }
      await page.close();
    }
    return captured;
  });
}

// Pseudo-classes that describe a transient state rather than the element's
// identity. Coverage asks "could this rule ever reach this element", so they
// are stripped before `el.matches()`; `:disabled` is kept, because whether a
// probe is disabled is a fixed property of the fixture.
const STATE_PSEUDO =
  /:(hover|active|focus|focus-visible|focus-within|visited|target)\b/gu;

async function captureMatchingRulesAndMarkup() {
  return withFixture(undefined, async ({ browser, origin }) => {
    const page = await openFixture(browser, origin, VIEWPORTS[0]);
    await assertEveryProbePresent(page, PROBES, "the report viewport");
    const probes = await page.evaluate(
      ([ids, statePseudoSource]) => {
        const statePseudo = new RegExp(statePseudoSource, "gu");
        // Vite's dev server injects each source stylesheet as its own <style>
        // carrying data-vite-dev-id with the absolute source path, so a
        // matched rule can be attributed back to the file that wrote it.
        const fileOf = (sheet) => {
          const id =
            sheet.ownerNode?.dataset?.viteDevId ?? sheet.href ?? "(unknown)";
          const cleaned = String(id).split("?")[0];
          const index = cleaned.lastIndexOf("/apps/web/");
          const alt = cleaned.lastIndexOf("/packages/");
          const cut = index === -1 ? alt : index;
          return cut === -1 ? cleaned : cleaned.slice(cut + 1);
        };
        const collected = {};
        const visit = (rules, sheet, media, sink) => {
          for (const rule of rules) {
            if (rule.media !== undefined && rule.cssRules !== undefined) {
              const text = rule.conditionText ?? rule.media?.mediaText ?? "";
              visit(
                rule.cssRules,
                sheet,
                media === "" ? `@media ${text}` : `${media} @media ${text}`,
                sink,
              );
              continue;
            }
            if (
              rule.cssRules !== undefined &&
              rule.selectorText === undefined
            ) {
              visit(rule.cssRules, sheet, media, sink);
              continue;
            }
            if (typeof rule.selectorText !== "string") continue;
            sink.push({ rule, sheet, media });
          }
        };
        const flat = [];
        for (const sheet of document.styleSheets) {
          let rules;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          visit(rules, sheet, "", flat);
        }
        for (const probe of ids) {
          const element = document.querySelector(`[data-probe="${probe}"]`);
          // Presence was asserted before this evaluate; a null here would be a
          // programming error, not a skip.
          if (element === null) throw new Error(`probe missing: ${probe}`);
          const matched = [];
          for (const { rule, sheet, media } of flat) {
            const properties = [...rule.style].filter(
              (name) => !name.startsWith("--"),
            );
            if (properties.length === 0) continue;
            for (const selector of rule.selectorText.split(/,(?![^(]*\))/gu)) {
              const probeSelector = selector
                .trim()
                .replace(statePseudo, "")
                .trim();
              if (probeSelector.length === 0) continue;
              let hit = false;
              try {
                hit = element.matches(probeSelector);
              } catch {
                hit = false;
              }
              if (!hit) continue;
              matched.push({
                file: fileOf(sheet),
                media,
                selector: selector.trim().replace(/\s+/gu, " "),
                properties,
              });
            }
          }
          collected[probe] = matched;
        }
        return collected;
      },
      [MATCH_PROBES.map((probe) => probe.id), STATE_PSEUDO.source],
    );
    // Finding 3: the rendered DOM, straight out of React in real Chrome. This
    // is the only markup the catalog is allowed to show for a component.
    const markup = await page.evaluate(
      (ids) => {
        const out = {};
        for (const probe of ids) {
          const element = document.querySelector(`[data-probe="${probe}"]`);
          if (element === null) throw new Error(`probe missing: ${probe}`);
          out[probe] = { base: element.outerHTML };
        }
        return out;
      },
      PROBES.map((probe) => probe.id),
    );
    return { probes, markup };
  });
}

/** Digest of the rendered fixture DOM: what the fixture structurally IS. */
function structureDigest(markup) {
  const hash = createHash("sha256");
  for (const probe of Object.keys(markup).sort()) {
    hash.update(probe);
    hash.update("\0");
    for (const stage of Object.keys(markup[probe]).sort()) {
      hash.update(stage);
      hash.update("\0");
      hash.update(markup[probe][stage]);
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}

const flatten = (captured) => {
  const flat = {};
  for (const [key, states] of Object.entries(captured))
    for (const [state, record] of Object.entries(states))
      for (const [property, value] of Object.entries(record))
        flat[`${key}/${state}/${property}`] = value;
  return flat;
};

if (reportMatchingRules) {
  const { cssContractInputs } = await import("./ui-css-contract.mjs");
  const { cssInputsDigest } = await import("./ui-component-spec.mjs");
  const { probes, markup } = await captureMatchingRulesAndMarkup();
  const bindings = {
    cssInputsSha256: cssInputsDigest(cssContractInputs()),
    fixtureSha256: fileDigest(Object.values(spec.fixture ?? {})),
    gateScriptSha256: fileDigest([GATE_SCRIPT]),
    structureSha256: structureDigest(markup),
  };
  const reportPath = resolve(
    spec.matchedRulesFile ??
      `packages/ui-tokens/specs/${component}.matched-rules.json`,
  );
  writeFileSync(
    reportPath,
    await formatJson({
      generatedBy: `node ${GATE_SCRIPT} ${component} --report-matching-rules`,
      component,
      note: "Rules Chrome reports as matching each fixture probe element. The static checker refuses it once the CSS inputs, the fixture files, the rendered fixture DOM or this gate program change, and refuses it if any probe declared in the spec is absent.",
      ...bindings,
      probes,
    }),
  );
  const markupPath = resolve(
    spec.fixtureMarkupFile ??
      `packages/ui-tokens/specs/${component}.fixture-markup.json`,
  );
  writeFileSync(
    markupPath,
    await formatJson({
      generatedBy: `node ${GATE_SCRIPT} ${component} --report-matching-rules`,
      component,
      note: "outerHTML of each fixture probe after React rendered it in real Chrome, at the gate's primary viewport. docs/design/ui-catalog.html renders exactly these strings; no component markup in the catalog is hand-written.",
      viewport: `${VIEWPORTS[0].width}x${VIEWPORTS[0].height}`,
      ...bindings,
      markup,
    }),
  );
  process.stdout.write(
    `${component} matched-rules report written: ${reportPath}\n${component} fixture markup written: ${markupPath}\n`,
  );
  process.exit(0);
}

const captured = await capture();

if (writeBaseline !== undefined) {
  const target = resolve(writeBaseline);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(captured, null, 2)}\n`);
  process.stdout.write(`${component} baseline written: ${target}\n`);
}

const failures = [];

if (comparePath !== undefined) {
  const before = flatten(
    JSON.parse(readFileSync(resolve(comparePath), "utf8")),
  );
  const after = flatten(captured);
  const keys = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort();
  const diff = keys
    .filter((key) => before[key] !== after[key])
    .map(
      (key) =>
        `${key}: ${before[key] ?? "(absent)"} -> ${after[key] ?? "(absent)"}`,
    );
  if (diff.length)
    failures.push(
      `computed-style diff vs ${comparePath}:\n  ${diff.join("\n  ")}`,
    );
  else
    process.stdout.write(
      `${component} computed styles identical to ${comparePath}\n`,
    );
}

if (expectSpec) {
  const flat = flatten(captured);
  const mismatches = [];
  for (const [key, expected] of Object.entries(
    spec.browserExpectations ?? {},
  )) {
    const actual = flat[key];
    if (actual === undefined) mismatches.push(`${key}: not captured`);
    else if (actual !== expected)
      mismatches.push(`${key}: expected ${expected}, got ${actual}`);
  }
  if (mismatches.length)
    failures.push(
      `spec browserExpectations mismatch:\n  ${mismatches.join("\n  ")}`,
    );
  else
    process.stdout.write(
      `${component} matches ${Object.keys(spec.browserExpectations ?? {}).length} spec browser expectations\n`,
    );
}

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else if (
  writeBaseline === undefined &&
  comparePath === undefined &&
  !expectSpec
) {
  process.stdout.write(`${JSON.stringify(captured, null, 2)}\n`);
}
