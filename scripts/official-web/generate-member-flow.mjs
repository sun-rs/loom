import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDeclaration } from "./generate-navigation-leaves.mjs";
const base =
  "frontends/raft/upstream/raft-web-source/packages/web/src/components/";
function nested(source, name) {
  const ast = ts.createSourceFile("upstream.tsx", source, 99, true, 4),
    found = [];
  function walk(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === name)
      found.push(n.initializer.getText(ast));
    ts.forEachChild(n, walk);
  }
  walk(ast);
  if (found.length !== 1) throw Error("Upstream declaration changed: " + name);
  return found[0];
}
function omitInactiveBranches(expression, predicate) {
  const prefix = "const value=",
    source = prefix + expression + ";";
  const ast = ts.createSourceFile("upstream.tsx", source, 99, true, 4),
    spans = [];
  function walk(node) {
    if (predicate(node, ast)) {
      spans.push([
        node.getStart(ast) - prefix.length,
        node.end - prefix.length,
      ]);
      return;
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
  let result = expression;
  for (const [a, b] of spans.sort((a, b) => b[0] - a[0]))
    result = result.slice(0, a) + result.slice(b);
  return result;
}
export function generateMemberFlow() {
  const strip = readFileSync(base + "channel/ChannelOverflowMenu.tsx", "utf8"),
    page = readFileSync(base + "agent/ChannelMembers.tsx", "utf8");
  const stripNames = [
    "STRIP_MAX_ROWS",
    "STRIP_TILE_SIZE_PX",
    "STRIP_TILE_GAP_PX",
    "STRIP_FALLBACK_COLUMNS",
    "STRIP_TILE_BUTTON_CLASS",
    "MEMBERS_STRIP_TOOLTIP_DELAY_MS",
    "NO_CHANNEL_EXTERNAL_MEMBERS",
    "MemberStripTooltip",
    "getStripColumnCount",
    "getVisibleMemberLimit",
    "createStripColumnStore",
    "MembersStrip",
  ];
  let stripCode = stripNames
    .map((n) => extractDeclaration(strip, n))
    .join("\n");
  stripCode = stripCode
    .replace("function MembersStrip(", "export function MembersStrip(")
    .replace(
      /<AgentActivityDot\s+agentId=\{agent.id\}\s+fallbackActivity=\{agentStatusFallbackActivity\(agent.status\)\}\s*\/>/g,
      "<>{agent.badge}</>",
    );
  const rowsSource = readFileSync(
    base + "channel/ChannelMemberList.tsx",
    "utf8",
  );
  let rows = [
    "MEMBER_ROW_CLASS",
    "MEMBER_ROW_TITLE_CLASS",
    "MEMBER_ROW_SUB_CLASS",
    "ChannelMemberRow",
    "ChannelMemberRemoveButton",
    "ChannelMemberHoverActions",
  ]
    .map((n) => extractDeclaration(rowsSource, n))
    .join("\n");
  rows = rows.replace(
    /badge=\{type === "agent" && agentId \? \([\s\S]*?\) : undefined\}/,
    "presence={presence}",
  );
  rows = rows
    .replace(
      "  agentFallbackActivity,",
      "  agentFallbackActivity,\n  presence,",
    )
    .replace(
      "  agentFallbackActivity?: AgentActivity;",
      "  agentFallbackActivity?: AgentActivity;\n  presence?: Presence;",
    );
  stripCode = stripCode.replace(
    /badge=\{\s*\(?\s*<>\{agent.badge\}<\/>\s*\)?\s*\}/g,
    "presence={agent.presence}",
  );
  const pure = [
    "MemberPageSection",
    "AddMemberCandidateBody",
    "CANDIDATE_ROW_CLASS",
    "candidateToggleRowClass",
  ]
    .map((n) => extractDeclaration(page, n))
    .join("\n");
  let candidates = nested(page, "addCandidateRows").replace(
    /<AgentActivityDot agentId=\{agent.id\} \/>/g,
    "<>{agent.badge}</>",
  );
  // Keep original picker composition; backend create/join semantics remain in callback slots.
  candidates = candidates
    .replace('trackAgentCreateOpened("channel_members");', "")
    .replace("setShowCreateAgent(true);", "onCreate();");
  candidates = candidates
    .replace(
      'formatMessage({ id: "channel.addMembers.createAgent" })',
      '"创建角色"',
    )
    .replace(
      'formatMessage({ id: "channel.addMembers.createAgentAutoJoin" }, { channel: `#${currentChannel?.name ?? ""}` })',
      '"创建配置后，返回这里选择并添加实例"',
    );
  candidates = omitInactiveBranches(
    candidates,
    (node, ast) =>
      ts.isIfStatement(node) && node.expression.getText(ast) === "!multiSelect",
  );
  const add = omitInactiveBranches(
    nested(page, "addView"),
    (node, ast) =>
      ts.isJsxExpression(node) &&
      node.expression?.getText(ast).startsWith("pendingJoinAgent &&"),
  );
  return `// GENERATED from locked db5e399 ChannelOverflowMenu/ChannelMembers. Original JSX;
// imports, activity badge, create callback and typed data slots bind Loom. No upstream stores.
import {useCallback,useState,useSyncExternalStore} from 'react';
import type {ReactNode,ReactElement,ChangeEvent,MouseEvent} from 'react';
import {useIntl} from 'react-intl';
import {AlertTriangle,ArrowLeft,ChevronRight,Plus,Search,Users,UserMinus,X} from 'lucide-react';
import type {Presence} from 'raft-ui';
import {Badge,Button,Card,Spinner,Skeleton,TooltipProvider,PanelHeader,PanelAction,InputGroup,InputGroupAddon,InputGroupInput,CheckboxIndicator,SidebarSection,SidebarSectionHeader,SidebarSectionDisclosure,SidebarSectionChevron,SidebarSectionTitle,SidebarSectionCount,SidebarList} from 'raft-ui';
import AvatarSlot from '../packages/web/src/components/ui/AvatarSlot.tsx';
import SectionEyebrow from '@loom/raft-web-source/SectionEyebrow';
import Tooltip from '@loom/raft-web-source/Tooltip';
import Banner from '@loom/raft-web-source/Banner';
import EmptyState from '@loom/raft-web-source/EmptyState';
import FormField from '../packages/web/src/components/ui/FormField.tsx';
export type Member={id:string;name:string;displayName?:string;description?:string;avatarUrl?:string|null;gravatarHash?:string|null;badge?:ReactNode;presence?:Presence;userId?:string;handles?:string[]};
type ChannelAgent=Member;type ChannelHuman=Member;type ChannelExternalMember=Member & {displayName:string};
${stripCode}
${pure}
type AgentActivity=string;
${rows}
export function MemberPage({showAddSection,membersLoading,totalParticipants,handleBackOrReset,rosterQuery,handleRosterQueryChange,visibleHumans,visibleAgents,renderHumanRow,renderAgentRow,openAddSection,showAddEntry,children,error}:{showAddSection:boolean;membersLoading:boolean;totalParticipants:number;handleBackOrReset:()=>void;rosterQuery:string;handleRosterQueryChange:(e:ChangeEvent<HTMLInputElement>)=>void;visibleHumans:Member[];visibleAgents:Member[];renderHumanRow:(m:Member,page:boolean)=>ReactNode;renderAgentRow:(m:Member,page:boolean)=>ReactNode;openAddSection:()=>void;showAddEntry:boolean;children?:ReactNode;error?:string}){
 const {formatMessage}=useIntl();const roleError=error,roleChangeFailed=false,removeTarget=false,hasAvailable=true;const visibleExternalMembers:ChannelExternalMember[]=[];const renderExternalRow=()=>null;
 const pageHeader=${nested(page, "pageHeader")};
 const pageListView=${nested(page, "pageListView")};
 return <div className="flex min-h-0 flex-1 flex-col bg-layer-canvas text-foreground" data-testid="member-page">{pageHeader}{showAddSection?<div className="flex min-h-0 flex-1 flex-col px-4 py-3">{children}</div>:pageListView}</div>;
}
export function MemberPicker({filteredAgents,memberSearch,handleMemberSearchChange,selectedKeys,toggleCandidate,adding,handleConfirmAddClick,onCreate,hasAvailable,error}:{filteredAgents:Member[];memberSearch:string;handleMemberSearchChange:(e:ChangeEvent<HTMLInputElement>)=>void;selectedKeys:Set<string>;toggleCandidate:(key:string)=>void;adding:boolean;handleConfirmAddClick:()=>void;onCreate:()=>void;hasAvailable:boolean;error?:string}){
 const {formatMessage}=useIntl();const failedKeys=new Set<string>(),filteredHumans:Member[]=[];
 const candidateKey=(_kind:string,id:string|undefined)=>id??"";
 const hasFilteredResults=filteredAgents.length>0,capabilities={createAgents:true},createEntryPromoted=false,createAgentPrefillName='',currentChannel=undefined as {name:string}|undefined;

 const candidateNameByKey=new Map(filteredAgents.map(a=>[a.id,a.displayName??a.name]));
 const addError:string|undefined=error,isPage=true;
 const addCandidateRows=${candidates};
 const addView=${add};
 return addView;
}
`;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeFileSync(
    "frontends/raft/loom/OfficialMemberFlow.generated.tsx",
    generateMemberFlow(),
  );
