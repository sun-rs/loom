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
const names = ["HTt", "UTt", "WTt", "GTt", "KTt", "qTt", "JTt"];
const bodies = names.map((name) => {
  const body = extractDeclaration(source, name);
  if (
    createHash("sha256").update(body).digest("hex") !==
    manifest.declarations.find((d) => d.name === name)?.sha256
  )
    throw Error("Upstream navigation hash changed: " + name);
  return body;
});
writeFileSync(
  "frontends/raft/loom/OfficialSortableNavigation.generated.js",
  `// GENERATED: byte-exact published Raft declaration bodies. Imports bind presentation dependencies and Loom device preferences.
import * as k from 'react';
import * as J from 'react/jsx-runtime';
import {useNavigationIntl as Z} from './navigation-preferences';
import {useSensors as TT,useSensor as wT,PointerSensor as oE,KeyboardSensor as nE,DndContext as jE,closestCenter as MT} from '@dnd-kit/core';
import {sortableKeyboardCoordinates as mk,arrayMove as tk,SortableContext as uk,verticalListSortingStrategy as sk,useSortable as fk} from '@dnd-kit/sortable';
import {CSS as yT} from '@dnd-kit/utilities';
import {useNavigationPreferences as pG,normalizeRailOrder as zte} from './navigation-preferences';
${bodies.join("\n")}
export {qTt as OfficialSortableNavigation};
`,
);
