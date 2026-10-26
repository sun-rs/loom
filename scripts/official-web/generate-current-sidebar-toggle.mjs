import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { extractDeclaration } from "./generate-navigation-leaves.mjs";
const dir = "frontends/raft/upstream/published-2026-10-26/";
const source = readFileSync(dir + "activity-collapse-source.js", "utf8");
const manifest = JSON.parse(
  readFileSync(dir + "activity-collapse-manifest.json", "utf8"),
);
const bodies = manifest.declarations.map(({ name, sha256 }) => {
  const body = extractDeclaration(source, name);
  if (createHash("sha256").update(body).digest("hex") !== sha256)
    throw Error("Official collapse declaration drift: " + name);
  return body;
});
writeFileSync(
  "frontends/raft/loom/CurrentSidebarToggle.generated.js",
  `// GENERATED: official 1.21.34 function bodies. Only imports/constants are external bindings.
import * as X from 'react/jsx-runtime';
import {AppShellSidebarTrigger as ete,AppRailItem as jc,AppRailItemIcon as jl,Kbd as Iu} from 'raft-ui';
import {PanelLeftOpen as ae,PanelLeftClose as ve} from 'lucide-react';
import GN from '@loom/raft-web-source/Tooltip';
import {useSidebarPreference as _E,sidebarShortcutLabel as nze,sidebarShortcutKeys as rze} from './sidebar-preference';
import {useNavigationIntl as W} from './navigation-preferences';
const p$='app-sidebar',m$='app-sidebar-toggle',b$={right:{side:'right'}};
${bodies.join("\n")}
export {kKe as CurrentSidebarToggle,CKe as toggleColumn,_$ as setColumnHidden};
`,
);
