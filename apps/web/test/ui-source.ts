import { readFileSync } from "node:fs";

// Test locator for the one maintained owner after library adoption. There is no
// runtime compatibility module or fallback to the old app-owned implementation.
export function readUiSource(path: string): string {
  const component =
    /^components\/(icon|panel-header|panel-header-action|panel-tabs|panel-resizer)\.tsx$/.exec(
      path,
    );
  const target = component
    ? `../../../packages/ui-web/src/neo-brutalist/${component[1]}.tsx`
    : [
          "activity.css",
          "interaction-state.css",
          "panel-layout.css",
          "panel-foundations.css",
          "settings.css",
        ].includes(path)
      ? `../../../packages/ui-tokens/src/neo-brutalist/${path}`
      : `../src/${path}`;
  return readFileSync(new URL(target, import.meta.url), "utf8");
}
