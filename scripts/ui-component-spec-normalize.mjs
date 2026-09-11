// Canonical value form shared by the component-spec checker and its tests.
//
// A spec expectation is written as an UPSTREAM LITERAL (`28px`,
// `2px solid oklch(0% 0 0)`, `700`) and never as a RAH token reference. The
// checker resolves RAH's `var()`/`calc()` down to a literal and then compares
// both sides in this normalized form:
//
//   1. trim, then collapse every run of whitespace to a single space;
//   2. lowercase (colors, keywords and font-family strings alike);
//   3. `a , b` / `a,b` -> `a, b`, and no padding just inside parentheses;
//   4. a bare leading dot gains its zero: `.4` -> `0.4`, `-.5` -> `-0.5`;
//   5. a zero length loses its unit: `0px` / `0rem` / `0em` -> `0`;
//   6. colors are canonicalized to lowercase 6-digit hex ONLY through the
//      explicit table below. Upstream writes pure black and white as oklch and
//      RAH writes them as hex; nothing else is folded, so a genuine colour
//      divergence still fails. Every other colour stays exactly as upstream
//      wrote it.
//
// Rule 6's table is deliberately tiny and exhaustive. Add to it only with an
// upstream literal on one side and the RAH literal it is provably identical to
// on the other.
const COLOR_EQUIVALENTS = new Map([
  ["oklch(0% 0 0)", "#000000"],
  ["oklch(100% 0 0)", "#ffffff"],
]);

const expandShortHex = (value) =>
  value.replace(
    /#([0-9a-f])([0-9a-f])([0-9a-f])(?![0-9a-f])/gu,
    (_, r, g, b) => `#${r}${r}${g}${g}${b}${b}`,
  );

/** Fold one value into the canonical comparison form documented above. */
export function normalizeLiteral(value) {
  let text = String(value).trim().replace(/\s+/gu, " ").toLowerCase();
  text = text.replace(/\s*,\s*/gu, ", ");
  text = text.replace(/\(\s+/gu, "(").replace(/\s+\)/gu, ")");
  text = text.replace(/(^|[\s(,])(-?)\.(\d)/gu, "$1$20.$3");
  text = text.replace(/(^|[\s(,])0(px|rem|em)(?![\w-])/gu, "$10");
  text = expandShortHex(text);
  for (const [from, to] of COLOR_EQUIVALENTS) text = text.split(from).join(to);
  return text;
}

/** True when `value` still references a CSS custom property. */
export const referencesVar = (value) => /var\(/u.test(String(value));
