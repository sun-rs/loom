import { dirname, resolve } from "node:path";
/** Resolve the target file, not the spelling of its relative import. */
export function resolveOfficialApi(
  source: string,
  importer: string | undefined,
  loomRoot: string,
): string | null {
  if (!importer || !source.startsWith(".")) return null;
  const original = resolve(loomRoot, "../packages/web/src/api/client");
  const target = resolve(dirname(importer), source).replace(/\.ts$/, "");
  return target === original ? resolve(loomRoot, "upstream-api.ts") : null;
}
