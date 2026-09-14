// Real-Chrome computed-style gate for the chat message row family component
// spec (docs/design/component-specs/message-row.zh-CN.md §自动检查要求).
//
//   node scripts/run-message-row-spec-browser-gate.mjs --write-baseline <path>
//   node scripts/run-message-row-spec-browser-gate.mjs --compare <path>
//   node scripts/run-message-row-spec-browser-gate.mjs --expect-spec
//   node scripts/run-message-row-spec-browser-gate.mjs --report-matching-rules
//
// `--compare` must produce an empty diff: it is what proves a same-value token
// substitution changed nothing. `--expect-spec` checks the captured values
// against packages/ui-tokens/specs/message-row.spec.json `browserExpectations`.
//
// STATUS 2026-09-12 (owner review): the sq-btn and sidebar-row copies of this
// program were replaced by the spec-driven
// scripts/run-component-spec-browser-gate.mjs. This one could NOT be folded in
// with them, because message-row has no packages/ui-tokens/specs/
// message-row.spec.json yet — it is a 待实施 component (doc only), so there is
// no spec for a spec-driven gate to read. It therefore keeps its own probe
// table, and it does NOT produce the four-way-bound report or the fixture
// markup export the generic gate produces. Fold it in by writing the spec
// JSON (probes + gate + fixture + gateScript + fixtureMarkupFile) and deleting
// this file; until then message-row is not a finished component anywhere.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createServer } from "vite";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";

const argv = process.argv.slice(2);
const flag = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};
const writeBaseline = flag("--write-baseline");
const comparePath = flag("--compare");
const expectSpec = argv.includes("--expect-spec");
// `--report-matching-rules` answers the question the static checker cannot:
// which CSS rules actually match each probe ELEMENT, rather than which rule
// selectors happen to spell a component class. The browser owns the selector
// engine, so it does the matching; the result is committed and the static
// checker consumes it, refusing it once the CSS inputs change (content hash).
const reportMatchingRules = argv.includes("--report-matching-rules");

// Every property the spec constrains. Longhands only, so a shorthand rewrite
// can never hide a value change behind a different serialization.
const PROPERTIES = [
  "width",
  "height",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-top-color",
  "box-shadow",
  "transform",
  "opacity",
  "pointer-events",
  "font-family",
  "font-weight",
  "font-size",
  "line-height",
  "letter-spacing",
  "text-transform",
  "color",
  "background-color",
  "transition-property",
  "transition-duration",
  "outline-width",
  "outline-style",
  "outline-color",
  "outline-offset",
  "gap",
];

// `interactive: false` marks a probe with no hover/active/focus state of its
// own (a span inside a row); only its base row is read. `hoverHost` names an
// ancestor probe to hover instead: the compact row's time is revealed by
// `group-hover/message`, so it is read while its row is hovered.
const PROBES = [
  { probe: "msg-first", interactive: true },
  { probe: "msg-avatar", interactive: false },
  { probe: "msg-head", interactive: false },
  { probe: "msg-author", interactive: false },
  { probe: "msg-time", interactive: false },
  { probe: "msg-compact", interactive: true },
  { probe: "msg-compact-gutter", interactive: false },
  { probe: "msg-compact-time", interactive: false, hoverHost: "msg-compact" },
  { probe: "msg-system", interactive: false },
  { probe: "msg-with-task", interactive: true },
  { probe: "msg-role", interactive: false },
  { probe: "msg-task-badge", interactive: true },
  { probe: "thread-preview", interactive: true },
  { probe: "thread-preview-toggle", interactive: false },
  { probe: "thread-preview-line", interactive: false },
  { probe: "thread-preview-avatar", interactive: false },
  { probe: "thread-preview-time", interactive: false },
  { probe: "date-divider", interactive: false },
  { probe: "date-divider-line", interactive: false },
  { probe: "date-divider-label", interactive: false },
];

const MATCH_PROBES = PROBES.map((probe) => probe.probe);

// The message row has no responsive branch of its own; 390x844 is required by
// AGENTS.md for any responsive change and records the narrow reading.
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

// The row transitions colors over 150ms. Reading before it lands captures
// interpolated garbage, which makes --compare unstable, so every state read
// waits out the transition plus two frames.
const settle = (page) => page.waitForTimeout(320);

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

async function capture() {
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
  const captured = {};
  try {
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      await page.goto(`${origin}/test/message-row-spec-fixture.html`);
      await page
        .locator('[data-probe="msg-first"]')
        .waitFor({ state: "attached" });
      // Fonts must settle or font-family/font-weight read mid-swap.
      await page.evaluate(() => document.fonts.ready);
      for (const { probe, interactive, disabled, hoverHost } of PROBES) {
        const key = `${viewport.width}x${viewport.height}/${probe}`;
        const locator = page.locator(`[data-probe="${probe}"]`);
        const states = {};
        // Park the mouse away from every probe before the base read.
        await page.mouse.move(5, 5);
        await settle(page);
        states.base = await readProbe(page, probe);
        // A probe with no box is either display:none itself or inside an
        // ancestor that is. Recording the base row still proves *that* it is
        // not rendered, which is what the 390px 挂起 question needs; it has no
        // interactive states to read.
        if (
          states.base.display === "none" ||
          states.base["client-width"] === "0"
        ) {
          captured[key] = states;
          continue;
        }
        if (hoverHost !== undefined) {
          // The value this probe exists to record only appears while its row is
          // hovered (upstream `group-hover/message:text-black/40`).
          await page.locator(`[data-probe="${hoverHost}"]`).hover();
          await settle(page);
          states["host-hover"] = await readProbe(page, probe);
          await page.mouse.move(5, 5);
          await settle(page);
        }
        if (disabled === true) {
          // A disabled control has no hover/active/focus-visible of its own;
          // the disabled read IS the state the spec constrains.
          states.disabled = states.base;
        } else if (interactive) {
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
            previous.id = "message-row-focus-seed";
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
            document.getElementById("message-row-focus-seed")?.remove();
            document.activeElement?.blur();
          });
        }
        captured[key] = states;
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return captured;
}

// Pseudo-classes that describe a transient state rather than the element's
// identity. Coverage asks "could this rule ever reach this element", so they
// are stripped before `el.matches()`; `:disabled` is kept, because whether a
// probe is disabled is a fixed property of the fixture.
const STATE_PSEUDO =
  /:(hover|active|focus|focus-visible|focus-within|visited|target)\b/gu;

async function captureMatchingRules() {
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
    const page = await browser.newPage({
      viewport: VIEWPORTS[0],
      deviceScaleFactor: 1,
    });
    await page.goto(`${origin}/test/message-row-spec-fixture.html`);
    await page.locator('[data-probe="msg-first"]').waitFor();
    return await page.evaluate(
      ([probes, statePseudoSource]) => {
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
        for (const probe of probes) {
          const element = document.querySelector(`[data-probe="${probe}"]`);
          if (element === null) continue;
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
      [MATCH_PROBES, STATE_PSEUDO.source],
    );
  } finally {
    await browser.close();
    await server.close();
  }
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
  const probes = await captureMatchingRules();
  const target = resolve(
    "packages/ui-tokens/specs/message-row.matched-rules.json",
  );
  writeFileSync(
    target,
    `${JSON.stringify(
      {
        generatedBy:
          "node scripts/run-message-row-spec-browser-gate.mjs --report-matching-rules",
        note: "Rules Chrome reports as matching each fixture probe element. Regenerate whenever the CSS inputs change; the static checker refuses a stale report by cssInputsSha256.",
        cssInputsSha256: cssInputsDigest(cssContractInputs()),
        probes,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`message-row matched-rules report written: ${target}\n`);
  process.exit(0);
}

const captured = await capture();

if (writeBaseline !== undefined) {
  const target = resolve(writeBaseline);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(captured, null, 2)}\n`);
  process.stdout.write(`message-row baseline written: ${target}\n`);
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
      `message-row computed styles identical to ${comparePath}\n`,
    );
}

if (expectSpec) {
  const spec = JSON.parse(
    readFileSync(
      new URL(
        "../packages/ui-tokens/specs/message-row.spec.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
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
      `message-row matches ${Object.keys(spec.browserExpectations ?? {}).length} spec browser expectations\n`,
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
