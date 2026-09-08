import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

const uncomment = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "");

// InteractivePopover renders Base UI Popover.Positioner. Its
// utils/useAnchorPositioning.js writes this property on the Positioner at
// runtime, and Popover.Popup inherits it. Keep exact, verified owners only.
export const runtimeCssVariableOwners = {
  "--available-height": "@base-ui/react/popover/positioner",
};

// CSS custom properties may also be supplied explicitly by a React style prop.
// A prefix is never an exemption: a misspelled --rah-* name must still fail.
export function unresolvedCssVariables(inputs, runtimeVariables = []) {
  const entries = Object.entries(inputs).map(([path, source]) => [
    path,
    uncomment(source),
  ]);
  const declared = new Set([
    ...runtimeVariables,
    ...entries.flatMap(([, source]) =>
      [...source.matchAll(/(--[\w-]+)["']?\s*:/g)].map((match) => match[1]),
    ),
  ]);
  const errors = new Set();
  for (const [path, source] of entries) {
    if (!path.endsWith(".css")) continue;
    // A comma directly after the name makes its fallback explicit. Nested var()
    // calls are scanned independently, so an unresolved fallback still fails.
    for (const match of source.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
      if (match[2] !== "," && !declared.has(match[1]))
        errors.add(`${path}: ${match[1]}`);
    }
  }
  return [...errors].sort();
}

export function cssContractInputs() {
  const roots = [
    "apps/web/src",
    "packages/ui-tokens/src",
    "packages/ui-web/src",
  ];
  return Object.fromEntries(
    roots.flatMap((root) =>
      readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(css|tsx|ts)$/.test(entry.name))
        .map((entry) => {
          const path = relative(
            process.cwd(),
            resolve(entry.parentPath, entry.name),
          );
          return [path, readFileSync(path, "utf8")];
        }),
    ),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const errors = unresolvedCssVariables(
    cssContractInputs(),
    Object.keys(runtimeCssVariableOwners),
  );
  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write("Product CSS custom-property references resolve.\n");
}
