import ts from "typescript";
import prettier from "prettier";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { withPinnedRelease } from "./pinned-release.mjs";
const base = "frontends/raft/loom/";
const walk = (node, visit) => {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
};
export async function generateWorkingSurfaces140() {
  return withPinnedRelease(async ({ directory, metadata }) => {
    const lock = JSON.parse(
      readFileSync(directory + "/release-lock.json", "utf8"),
    );
    const module = lock.files.find((f) =>
      f.url.endsWith("/app-shell-DOYrxQ-_.js"),
    );
    const locale = lock.files.find((f) => f.url.endsWith("/zh-cn-zgUfP7tb.js"));
    if (!module || !locale)
      throw Error("Missing pinned working/overview source");
    const source = readFileSync(directory + "/" + module.file, "utf8");
    const ast = ts.createSourceFile(module.url, source, 99, true, 1);
    const functions = new Map(
      ast.statements
        .filter(ts.isFunctionDeclaration)
        .map((n) => [n.name.text, n]),
    );
    const variables = new Map();
    for (const n of ast.statements)
      if (ts.isVariableStatement(n))
        for (const d of n.declarationList.declarations)
          variables.set(d.name.getText(ast), d);
    const declaration = (name) => {
      const f = functions.get(name);
      if (f) return f.getText(ast);
      const v = variables.get(name);
      if (!v?.initializer) throw Error("Missing declaration " + name);
      return `const ${name}=${v.initializer.getText(ast)};`;
    };
    const returned = (name) => {
      const returns = functions
        .get(name)
        ?.body.statements.filter(ts.isReturnStatement);
      if (returns?.length !== 1) throw Error("Ambiguous native return " + name);
      return returns[0].expression.getText(ast);
    };
    const row = functions.get("Uft");
    const card = row?.body.statements.find(
      (n) =>
        ts.isIfStatement(n) &&
        n.expression.getText(ast).replaceAll(" ", "") === "r===`cards`",
    );
    const cardReturn = card?.thenStatement.statements.find(
      ts.isReturnStatement,
    )?.expression;
    if (!cardReturn) throw Error("Missing native rack card");
    let overviewEntry;
    walk(ast, (n) => {
      if (!ts.isCallExpression(n)) return;
      const props = n.arguments[1];
      if (!props || !ts.isObjectLiteralExpression(props)) return;
      if (
        props.properties.some(
          (p) =>
            ts.isPropertyAssignment(p) &&
            p.name.getText(ast) === '"data-testid"' &&
            ts.isStringLiteralLike(p.initializer) &&
            p.initializer.text === "sidebar-computers-overview",
        )
      )
        overviewEntry = n.getText(ast);
    });
    if (!overviewEntry) throw Error("Missing native overview entry");
    const strings = {};
    const cn = ts.createSourceFile(
      locale.url,
      readFileSync(directory + "/" + locale.file, "utf8"),
      99,
      true,
      1,
    );
    walk(cn, (n) => {
      if (ts.isPropertyAssignment(n) && ts.isStringLiteralLike(n.initializer)) {
        const id = n.name.text;
        if (
          id?.startsWith("layout.workingNow.") ||
          id === "layout.sidebar.staleCountsNotice" ||
          id === "layout.sidebar.computersOverview" ||
          id?.startsWith("machine.rack.") ||
          id?.startsWith("machine.mobile.") ||
          id?.startsWith("agent.migration.target.") ||
          id?.startsWith("emptyState.noComputers")
        )
          strings[id] = n.initializer.text;
      }
    });
    if (
      !strings["layout.workingNow.summary"] ||
      !strings["layout.sidebar.staleCountsNotice"]
    )
      throw Error("Missing native captions");
    const rootNames = [
      "Aq",
      "BWe",
      "jq",
      "RWe",
      "flt",
      "plt",
      "Ist",
      "Fst",
      "l7",
      "Pst",
      "Nst",
      "Mst",
      "kst",
      "Ast",
      "jst",
      "Cft",
      "Fft",
      "Oft",
      "Aft",
      "y9",
      "kft",
      "_9",
      "Dft",
      "Nft",
      "Pft",
      "Wft",
      "v9",
      "Eft",
      "Mft",
      "G5",
    ];
    // Native working-item expiry is intentionally absent: Kernel/AgentHost observations, not
    // an upstream event store or time-to-live, determine Loom's current work set.
    const declarations = rootNames
      .map(declaration)
      .join("\n")
      .replace(/VWe\(r\),\s*/, "");
    const js = await prettier.format(
      `// GENERATED from complete pinned Web1.21.40. Native declarations/JSX; explicit data and capability slots only.
import * as K from "react";import * as q from "react/jsx-runtime";
import {useIntl} from "react-intl";
import {ChevronRight as R,List as Rt,LayoutGrid as Er,Monitor as ht,RefreshCw as bn,Plus as gn} from "lucide-react";
import {Popover as us,PopoverTrigger as uc,PopoverContent as As,PanelNotice as Zl,PanelNoticeContent as ml,Spinner as ba,SegmentedControl as Iu,SegmentedControlItem as $i,SegmentedControlLabel as Hi,Separator as Ao,Card as tu,CardHeader as xc,CardLeading as ms,CardTitle as Jr,CardTrailing as $c,CardDescription as bc,CardContent as Xa,Button as G,SidebarItem as $s,SidebarItemIcon as no} from "raft-ui";
import kv from "../packages/web/src/components/ui/AvatarSlot.tsx";
import kP from "../packages/web/src/components/ui/PanelHeader.tsx";
import XP from "@loom/raft-web-source/EmptyState";
const captions=${JSON.stringify(strings)};
const loomCaptions={"layout.sidebar.staleCountsNotice":captions["layout.sidebar.staleCountsNotice"].replace("Raft","Loom"),"layout.workingNow.summary":captions["layout.workingNow.summary"].replace("Agent","实例"),"machine.rack.agentCount":captions["machine.rack.agentCount"]?.replace("Agent","实例"),"machine.rack.colAgents":"实例"};
function H(){const intl=useIntl();return {formatMessage:(d,v)=>intl.formatMessage({...d,defaultMessage:loomCaptions[d.id]??captions[d.id]},v)};}
const WorkingData=K.createContext({items:[],enabled:true,onOpen:()=>{}});
const kq=select=>select(K.useContext(WorkingData));
const cw=select=>select({showLiveAgentActivityBar:K.useContext(WorkingData).enabled});
function FV(){const data=K.useContext(WorkingData);return K.useMemo(()=>({toAgent:data.onOpen}),[data.onOpen]);}
// Loom items carry observed text, never provider transcripts/descriptors.
function XA(){throw Error("Unexpected upstream activity descriptor");}
${declarations}
export function NativeWorkingSummary({items,enabled=true,onOpen,onFrame=false,variant="count"}){const data=K.useMemo(()=>({items,enabled,onOpen}),[items,enabled,onOpen]);return q.jsx(WorkingData.Provider,{value:data,children:q.jsx(Aq,{onFrame,variant})});}
export function NativeChannelWorking({items,enabled=true,memberIds,description}){const data=K.useMemo(()=>({items,enabled}),[items,enabled]);return q.jsx(WorkingData.Provider,{value:data,children:q.jsx(plt,{agentIdKey:memberIds.join(flt),description})});}
export function NativeSidebarFreshness({visible}){const {formatMessage:r}=H(),t="layout.sidebar.staleCountsNotice",n="sidebar-stale-notice";return ${returned("_nt").replace("yge(e)", "visible")};}
export function NativeComputerOverviewEntry({active:gi,onClick:vi}){const {formatMessage:r}=H();return ${overviewEntry};}
export function NativeComputerView({view:t,onChange:n}){const {formatMessage:e}=H();return ${returned("x9")};}
export function NativeComputerCounts({count,online,instances,className:e=""}){const {formatMessage:t}=H(),n=Array(count),i=online,a=instances;return ${returned("qft")};}
const ComputerData=K.createContext({});
function qft(){return K.useContext(ComputerData).titleSuffix;}
function x9(){return K.useContext(ComputerData).viewControl;}
function b9(){return K.useContext(ComputerData).children;}
function ComputerOverviewFrame(){const {count:i,loading:n,error,view:t,onRetry:l}=K.useContext(ComputerData),{formatMessage:e}=H(),r=error?"error":"loaded",s={registerMachines:false};return ${returned("Jft")};}
export function NativeComputerOverview(props){return q.jsx(ComputerData.Provider,{value:props,children:q.jsx(ComputerOverviewFrame,{})});}
export function NativeComputerRack({view:t,children:T}){const {formatMessage:n}=H(),e="desktop",c={usage:[],other:[]},h=null;return ${returned("b9")};}
const aft=()=>null,jft=()=>({});
// No local disk/memory/quota observations exist. Native unknown metrics remain empty;
// remote registration, migration, cloud billing and remote machine controls are omitted.
export function NativeComputerRow({machine:e,view:r,icon:z,name:B,instances:ne,facts:R,version:F,platform:P,instanceCount}){
const t=Array(instanceCount),n="desktop",i={usage:[],other:[]},S=e.status!=="online",ae=S?"bg-fill-subtle":"",N={},te=q.jsxs("div",{className:"flex min-w-0 items-center gap-2",children:[z,B]}),L=null,T=null,ee=null,ie=null,re=null,ue=null;
const oe=layout=>layout==="cell"?q.jsx("div",{role:"cell",className:y9+" shrink-0","aria-label":"磁盘状态未知"}):null,se=layout=>layout==="cell"?q.jsx("div",{role:"cell",className:y9+" shrink-0","aria-label":"内存状态未知"}):null;
const Qdt=()=>({usage:[],other:[]}),Sft=()=>null,p5=()=>F;
if(r==="cards"){const n=Qdt([e]);return ${cardReturn.getText(ast)};}
const de=t.length>0?q.jsx(Cft,{testId:"rack-slots-"+e.id,children:ne}):null,fe=Nft(i)+_9+Dft,pe={minWidth:fe,maxWidth:Math.max(520,fe)},me=2+i.usage.length+ +(i.other.length>0)+1;
return ${returned("Uft")};}
export {Cft as NativeComputerAvatarStrip};
`,
      { parser: "babel" },
    );
    const types = await prettier.format(
      `// GENERATED by generate-working-surfaces140.mjs.
import type {ReactNode,ReactElement} from "react";
export type WorkingItem={agentId:string;agentName:string;agentAvatarUrl?:string|null;activity:string;text:string};
export function NativeWorkingSummary(p:{items:WorkingItem[];enabled?:boolean;onOpen:(id:string)=>void;onFrame?:boolean;variant?:"count"|"full"}):ReactElement|null;
export function NativeChannelWorking(p:{items:WorkingItem[];enabled?:boolean;memberIds:string[];description?:string}):ReactElement|null;
export function NativeSidebarFreshness(p:{visible:boolean}):ReactElement|null;
export function NativeComputerOverviewEntry(p:{active:boolean;onClick:()=>void}):ReactElement;
export function NativeComputerView(p:{view:"list"|"cards";onChange:(view:string)=>void}):ReactElement;
export function NativeComputerCounts(p:{count:number;online:number;instances:number;className?:string}):ReactElement;
export function NativeComputerOverview(p:{count:number;loading:boolean;error:boolean;view:"list"|"cards";titleSuffix:ReactNode;viewControl:ReactNode;onRetry:()=>void;children:ReactNode}):ReactElement;
export function NativeComputerRack(p:{view:"list"|"cards";children:ReactNode}):ReactElement;
export function NativeComputerRow(p:{machine:{id:string;status:string};view:"list"|"cards";icon:ReactNode;name:ReactNode;instances:ReactNode;facts:ReactNode;version?:string;platform?:string;instanceCount:number}):ReactElement;
export function NativeComputerAvatarStrip(p:{children:ReactNode;testId:string}):ReactElement;
`,
      { parser: "typescript" },
    );
    return {
      js,
      types,
      provenance: {
        release: metadata.release,
        archiveSha256: metadata.sha256,
        module: {
          url: module.url,
          sha256: createHash("sha256").update(source).digest("hex"),
        },
        declarations: rootNames,
        renderReturns: ["_nt", "x9", "qft", "Jft", "b9", "Uft"],
        bindingSeams: [
          "WorkingData: authenticated AgentHost presence joined to instance principals; native event expiry removed",
          "Navigation: existing guarded Channel/instance-profile route",
          "Sidebar freshness: native confirmed-stale/unavailable predicate, never a generic initial loading line or invented unread counts",
          "Computer overview: verified local inventory and instance snapshot; unsupported remote/cloud actions omitted",
          "Native rack unknown disk/memory/quota cells stay unknown; no fabricated measurements",
        ],
      },
    };
  });
}
if (process.argv[1]?.endsWith("generate-working-surfaces140.mjs")) {
  const r = await generateWorkingSurfaces140();
  for (const [file, value] of [
    ["OfficialWorkingSurfaces140.generated.js", r.js],
    ["OfficialWorkingSurfaces140.generated.d.ts", r.types],
    [
      "working-surfaces140.provenance.json",
      JSON.stringify(r.provenance, null, 2) + "\n",
    ],
  ])
    writeFileSync(base + file, value);
}
