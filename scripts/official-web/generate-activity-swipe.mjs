import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { extractDeclaration } from "./generate-navigation-leaves.mjs";
const dir = "frontends/raft/upstream/published-2026-10-26/";
const source = readFileSync(dir + "activity-swipe-source.js", "utf8");
const manifest = JSON.parse(
  readFileSync(dir + "activity-swipe-manifest.json", "utf8"),
);
const bodies = manifest.declarations.map(({ name, sha256 }) => {
  const body = extractDeclaration(source, name);
  if (createHash("sha256").update(body).digest("hex") !== sha256)
    throw Error("Official collapse declaration drift: " + name);
  return body;
});
writeFileSync(
  "frontends/raft/loom/OfficialActivitySwipe.generated.js",
  `// GENERATED: unchanged Raft 1.21.34 mobile row gesture and recipes.
import * as q from 'react';
import * as _t from 'react-dom';
${bodies.join("\n")}
export {Ht as useOfficialRowSwipe,Pt as suppressNextSwipeClick,Lt as decideSwipe,Rt as isFullSwipe,zt as settleSwipe,sn as swipeRowClass,cn as swipeLayerClass,un as swipeDoneClass,dn as swipeSecondaryClass,fn as swipeAccessibleActionClass};
`,
);

writeFileSync(
  "frontends/raft/loom/OfficialActivitySwipe.generated.d.ts",
  'import type { HTMLAttributes } from "react";\nexport function useOfficialRowSwipe(options: {\n  enabled: boolean;\n  actionsWidth: number;\n  open: boolean;\n  onOpenChange: (open: boolean) => void;\n  onFullSwipe: () => void;\n  shouldYield?: () => boolean;\n}): {\n  ref: (element: HTMLElement | null) => void;\n  handlers: HTMLAttributes<HTMLElement>;\n};\nexport function suppressNextSwipeClick(event: PointerEvent): void;\nexport const swipeRowClass: string,\n  swipeLayerClass: string,\n  swipeDoneClass: string;\n\nexport const swipeSecondaryClass: string;\n\nexport const swipeAccessibleActionClass: string;\n',
);
