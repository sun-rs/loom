import ts from "typescript";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cssContractInputs } from "./ui-css-contract.mjs";
import { parseCssRules } from "./ui-component-spec.mjs";

const owner = "packages/ui-web/src/neo-brutalist/choice-row.tsx";
const styles = "packages/ui-tokens/src/neo-brutalist/choice-row.css";
const palette = /^(background(?:-.+)?|opacity|filter|--[\w-]+)$/;
const classesIn = (node) => {
  const result = new Set();
  const visit = (n) => {
    if (
      ts.isStringLiteralLike(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    )
      for (const word of n.text.split(/\s+/))
        if (/^[a-z][\w-]*$/.test(word)) result.add(word);
    ts.forEachChild(n, visit);
  };
  const attr = node.attributes.properties.find(
    (p) => ts.isJsxAttribute(p) && p.name.getText() === "className",
  );
  if (attr) visit(attr);
  return result;
};

/** Guard row-owned presentation, including page aliases and ancestor selectors.
 * Broad selectors are additionally covered by computed-style browser checks. */
export function choiceRowViolations(inputs) {
  const errors = [];
  const classes = new Set(["rah-choice-row"]);
  const containers = new Set();
  for (const [path, source] of Object.entries(inputs)) {
    if (!path.endsWith(".tsx") || path === owner) continue;
    const tree = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const aliases = new Set(["ChoiceRow"]);
    const visit = (node) => {
      if (
        ts.isImportSpecifier(node) &&
        (node.propertyName ?? node.name).text === "ChoiceRow"
      )
        aliases.add(node.name.text);
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const choice = aliases.has(node.tagName.getText(tree));
        for (const attr of node.attributes.properties) {
          if (choice && ts.isJsxSpreadAttribute(attr))
            errors.push(`${path}: ChoiceRow cannot spread local props`);
          if (ts.isJsxAttribute(attr)) {
            const name = attr.name.getText(tree);
            if (name.startsWith("data-choice-") || (choice && name === "style"))
              errors.push(`${path}: ${name} is shared-owner only`);
          }
        }
        if (choice) {
          for (const c of classesIn(node))
            if (!c.startsWith("is-")) classes.add(c);
          for (
            let parent = node.parent?.parent;
            parent;
            parent = parent.parent
          ) {
            if (ts.isJsxElement(parent)) {
              for (const c of classesIn(parent.openingElement))
                containers.add(c);
              break;
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  for (const [path, source] of Object.entries(inputs)) {
    if (!path.endsWith(".css") || path === styles) continue;
    if (/--choice-[\w-]+\s*:/.test(source))
      errors.push(`${path}: choice variables are shared-owner only`);
    for (const rule of parseCssRules(source, path)) {
      const selector = rule.selector;
      if (/:not\(\.rah-choice-row\)[^\s>+~]*$/.test(selector)) continue;
      // Find the subject without losing :is/:where arguments or splitting
      // whitespace inside them. A child icon's rule is not a row override.
      let subject = "",
        depth = 0;
      for (const char of selector) {
        if (char === "(" || char === "[") depth++;
        if (char === ")" || char === "]") depth--;
        if (!depth && /[\s>+~]/.test(char)) subject = "";
        else subject += char;
      }
      const row =
        /data-choice-|\.rah-choice-row\b/.test(subject) ||
        [...classes].some((c) =>
          new RegExp(`\\.${c}(?![\\w-])`).test(subject),
        ) ||
        (/^(button|\[role=)/.test(subject) &&
          [...containers].some((c) => selector.includes(`.${c}`)));
      if (
        row &&
        [
          ...Object.keys(rule.declarations),
          ...Object.keys(rule.customProperties ?? {}),
        ].some((p) => palette.test(p))
      )
        errors.push(
          `${path}: ${selector} overrides shared choice presentation`,
        );
    }
  }
  return [...new Set(errors)].sort();
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const errors = choiceRowViolations(cssContractInputs());
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Choice profiles keep colors and state opacity in the shared owner.",
  );
}
