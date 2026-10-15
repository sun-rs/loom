import { createRequire } from "node:module";
const requireUi = createRequire(new URL("../package.json", import.meta.url));
/** One UI runtime/context for frozen upstream consumers and local composition. */
export function resolveOfficialUi(source: string): string | null {
  return source === "raft-ui" || source.startsWith("raft-ui/")
    ? requireUi.resolve(source)
    : null;
}
export function officialUiAliases() {
  const manifest = requireUi("raft-ui/package.json") as {
    exports: Record<string, unknown>;
  };
  return Object.keys(manifest.exports).map((key) => {
    const source = key === "." ? "raft-ui" : "raft-ui/" + key.slice(2);
    return {
      find: new RegExp(
        "^" + source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
      ),
      replacement: resolveOfficialUi(source)!,
    };
  });
}
