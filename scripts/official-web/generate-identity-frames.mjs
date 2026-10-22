import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const base =
  "frontends/raft/upstream/raft-web-source/packages/web/src/components/";
function one(source, predicate) {
  const ast = ts.createSourceFile("source.tsx", source, 99, true, 4),
    found = [];
  function walk(n) {
    if (predicate(n, ast)) found.push(n);
    ts.forEachChild(n, walk);
  }
  walk(ast);
  if (found.length !== 1)
    throw Error("Identity frame source drift: " + found.length);
  return found[0].getText(ast);
}
const element = (source, tag) =>
  one(
    source,
    (n, a) => ts.isJsxElement(n) && n.openingElement.tagName.getText(a) === tag,
  );
export function generateIdentityFrames() {
  const sidebar = readFileSync(base + "layout/Sidebar.tsx", "utf8");
  let desktop = element(sidebar, "SidebarHeader");
  desktop = desktop
    .replace(
      '{railMode === "chat" && <WorkingNowSummary variant="count" />}',
      "",
    )
    .replaceAll("railLabel", "title")
    .replace(
      "<SidebarHeader>",
      "<SidebarHeader data-testid={testId} data-loom-root-header>",
    )
    .replace(
      "<SidebarHeaderTitle className=",
      "<SidebarHeaderTitle render={<h1 />} className=",
    );
  const mobile = one(
    sidebar,
    (n, a) =>
      ts.isJsxElement(n) &&
      n.openingElement.tagName.getText(a) === "PanelHeaderContent" &&
      n.getText(a).includes("<PanelTitle>{railLabel}</PanelTitle>"),
  )
    .replaceAll("railLabel", "title")
    .replace("<PanelTitle>", "<PanelTitle render={<h1 />}>");
  const agent = readFileSync(base + "agent/AgentDetailPanel.tsx", "utf8");
  const tabs = element(agent, "ConversationPanelTabs");
  const list = element(tabs, "SortableTabsList");
  const view = tabs
    .replace(list, "{children}")
    .replace(
      "<Tabs<AgentTab> value={activeTab} onValueChange={setActiveTab} />",
      "<Tabs value={value} onValueChange={onValueChange} />",
    );
  return `// GENERATED from locked db5e399 Sidebar and AgentDetailPanel. Presentation only.
// Explicit Loom slots: single-workspace mobile title/notification, fixed two-tab Role list (no native agent tab reordering).
import type {ReactNode} from "react";
import {SidebarHeader,SidebarHeaderTitle,PanelSectionHeader,PanelHeaderContent,PanelTitle,ConversationPanelTabs,Tabs} from "raft-ui";
export function OfficialSidebarHeader({desktop,title,testId,trailing}:{desktop:boolean;title:string;testId:string;trailing?:ReactNode}){return desktop?(${desktop}):(<PanelSectionHeader data-testid={testId} data-loom-root-header>${mobile}{trailing}</PanelSectionHeader>);}
export function OfficialRoleTabs({value,onValueChange,children}:{value:string;onValueChange:(value:string)=>void;children:ReactNode}){return <div className="min-w-0 max-w-full">${view}</div>;}
`;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeFileSync(
    "frontends/raft/loom/OfficialIdentityFrames.generated.tsx",
    generateIdentityFrames(),
  );
