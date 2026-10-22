import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { extractDeclaration } from "./generate-navigation-leaves.mjs";
const source = readFileSync(
  "frontends/raft/upstream/published-2026-10-22/navigation-source.js",
  "utf8",
);
const manifest = JSON.parse(
  readFileSync(
    "frontends/raft/upstream/published-2026-10-22/navigation-manifest.json",
    "utf8",
  ),
);
const bodies = ["ZTt", "QTt", "$Tt", "lEt"].map((name) => {
  const body = extractDeclaration(source, name);
  if (
    createHash("sha256").update(body).digest("hex") !==
    manifest.declarations.find((d) => d.name === name)?.sha256
  )
    throw Error("Sidebar source changed: " + name);
  return body;
});
writeFileSync(
  "frontends/raft/loom/OfficialSidebarToggle.generated.js",
  `// GENERATED: unchanged locked published Raft toggle declarations. Only dependency/data aliases are adapted.
import * as J from 'react/jsx-runtime';
import {AppShellSidebarTrigger as WBe,AppRailItem as mA,AppRailItemIcon as hA,Kbd as kD} from 'raft-ui';
import {PanelLeftOpen as bCe,PanelLeftClose as vCe} from 'lucide-react';
import XK from '@loom/raft-web-source/Tooltip';
import {useSidebarPreference as gJ,sidebarShortcutLabel as Ppt,sidebarShortcutKeys as Fpt} from './sidebar-preference';
import {useNavigationIntl as Z} from './navigation-preferences';
const j6={right:{side:'right'}};
${bodies.join("\n")}
export {lEt as OfficialSidebarToggle,$Tt as toggleSidebar};
`,
);
