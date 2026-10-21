import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDeclaration } from "./generate-navigation-leaves.mjs";
const base =
  "frontends/raft/upstream/raft-web-source/packages/web/src/components/layout/";
function one(source, predicate) {
  const ast = ts.createSourceFile("source.tsx", source, 99, true, 4),
    matches = [];
  function walk(n) {
    if (predicate(n, ast)) matches.push(n);
    ts.forEachChild(n, walk);
  }
  walk(ast);
  if (matches.length !== 1)
    throw Error("Identity row source drift: " + matches.length);
  return matches[0].getText(ast);
}
function element(source, tag) {
  return one(
    source,
    (n, a) => ts.isJsxElement(n) && n.openingElement.tagName.getText(a) === tag,
  );
}
export function generateIdentityRows() {
  const sidebar = readFileSync(base + "Sidebar.tsx", "utf8");
  let computer = element(
    extractDeclaration(sidebar, "ComputerRowBody"),
    "SidebarItem",
  );
  computer = computer.replace(
    one(
      computer,
      (n, a) =>
        ts.isJsxSelfClosingElement(n) && n.tagName.getText(a) === "StatusDot",
    ),
    "{statusDot}",
  );
  const meta = element(computer, "SidebarItemMeta");
  computer = computer.replace(
    meta,
    meta.slice(0, meta.indexOf(">") + 1) + "{statusLabel}</SidebarItemMeta>",
  );
  computer = computer.replace(
    "data-testid={`computer-list-item-${machine.id}`}",
    'data-testid="computer-desktop-row"',
  );
  let role = element(
    readFileSync(base + "MemberAgentRow.tsx", "utf8"),
    "SidebarItem",
  );
  for (const line of [
    "      onDoubleClick={handleDoubleClick}\n",
    "      onContextMenu={handleContextMenu}\n",
    '      {...makeLongPress("member-agent", agent.id)}\n',
  ]) {
    if (!role.includes(line)) throw Error("Role action binding drift");
    role = role.replace(line, "");
  }
  role = role.replace(
    "data-agent-id={agent.id}",
    "data-role-id={agent.id} aria-label={agent.name} disabled={busy}",
  );
  role = role.replace(
    "<SidebarAgentActivityBadge agentId={agent.id} />",
    "statusDot",
  );
  role = role.replace(
    one(
      role,
      (n, a) =>
        ts.isJsxElement(n) &&
        n.openingElement
          .getText(a)
          .includes("className={SIDEBAR_ROW_TRAILING_CLASS}"),
    ),
    "",
  );
  return `// GENERATED from locked db5e399 MemberAgentRow and Sidebar.ComputerRowBody JSX.
// Loom supplies identity, observed/aggregate presence and callbacks. Role has no instance runtime or DM/context actions.
import type {ReactNode,ReactElement} from "react";
import {SidebarItem,SidebarItemIcon,SidebarItemMeta,SidebarItemSubtitle,SidebarItemContent,SidebarItemTitle} from "raft-ui";
import {Monitor} from "lucide-react";
import AvatarSlot from "./OfficialAvatarSlot.generated";
import {sidebarItemClass} from "./OfficialNavigationLeaves.generated";
${extractDeclaration(sidebar, "SIDEBAR_ROW_PHONE_CLASS")}
export function OfficialComputerRow({machine,selected,onClick:handleClick,statusDot,statusLabel}:{machine:{id:string;name:string;description?:string|null};selected:boolean;onClick:()=>void;statusDot:ReactNode;statusLabel:ReactNode}){return (${computer});}
export function OfficialRoleRow({agent,selected,busy,onSelect,statusDot}:{agent:{id:string;name:string;displayName?:string;avatarUrl?:string;description?:string};selected:boolean;busy:boolean;onSelect:(id:string)=>void;statusDot:ReactElement}){const menuOpen=false;const handleClick=()=>onSelect(agent.id);return (${role});}
`;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeFileSync(
    "frontends/raft/loom/OfficialIdentityRows.generated.tsx",
    generateIdentityRows(),
  );
