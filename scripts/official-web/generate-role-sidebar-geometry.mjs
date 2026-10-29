// Selected published Web geometry, kept separate from the newer npm recipe.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export function generateRoleSidebarGeometry() {
  const base = "frontends/raft/upstream/role-sidebar-2026-10-30/",
    raw = readFileSync(base + "source.json");
  if (
    createHash("sha256").update(raw).digest("hex") !==
    JSON.parse(readFileSync(base + "source-lock.json", "utf8")).sha256
  )
    throw Error("Official sidebar source changed");
  const source = JSON.parse(raw),
    item = source.assets[0].excerpts["sidebarItem:["],
    header = source.assets[0].excerpts["sidebarSectionHeader:["];
  for (const value of ["pl-2", "pr-2.5", "border-[1.5px]"])
    if (!item.includes(value))
      throw Error("Published row geometry changed: " + value);
  if (
    !header.includes("px-2") ||
    !source.assets[1].excerpts[
      "scrollbar-quiet min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-2"
    ]
  )
    throw Error("Published sidebar frame changed");
  return `// GENERATED from published Raft Web 1.21.38; see upstream/role-sidebar-2026-10-30.
// Horizontal compatibility port only. Current npm recipes own all other states.
import type {CSSProperties} from "react";
export const roleSidebarFrameClass = "px-2";
export const roleSidebarHeaderStyle:CSSProperties = {paddingInline:8};
// New list-cell uses a pseudo border; old Web's real 1.5px border occupied space.
export const roleSidebarRowStyle:CSSProperties = {paddingInlineStart:8+1.5,paddingInlineEnd:10+1.5,"--cell-inset-x":"0px"} as CSSProperties;
`;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeFileSync(
    "frontends/raft/loom/OfficialRoleSidebarGeometry.generated.ts",
    generateRoleSidebarGeometry(),
  );
