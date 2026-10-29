// GENERATED from Web1.21.38 Hst/Vst/Wst. Stores/telemetry replaced only by explicit Loom props; offset observes its actual host.
import * as X from "react";import * as Z from "react/jsx-runtime";
import {PanelHeader as Yu,PanelAction as _u,Tabs as bl,TabsList as es,TabsTab as Ss,TabsLabel as Ho,ThreadIcon as Ml} from "raft-ui";
import {ArrowLeft as T,ListTodo as Ce,Paperclip as kt} from "lucide-react";
import {useCoverIntl as V} from "./thread-cover-intl";
var Vst=e=>e===`thread`?(0,Z.jsx)(Ml,{}):e===`tasks`?(0,Z.jsx)(Ce,{}):(0,Z.jsx)(kt,{});
function Hst({side:e,onBack:t,entries:r,onChange:i}){let{formatMessage:n}=V(),a=(0,X.useCallback)(e=>{i(e)},[i]);if(e.tabs.length===0)return null;let o=e=>e===`thread`?n({id:`message.threadPanel.thread`}):r[e]?.title??e;return(0,Z.jsxs)(Yu,{"data-testid":`thread-cover-tabs`,children:[(0,Z.jsx)(_u,{"aria-label":n({id:`task.sideColumn.coverBack`}),onClick:t,activateOnTouchEnd:!0,"data-testid":`thread-cover-back`,children:(0,Z.jsx)(T,{})}),(0,Z.jsx)(bl,{value:e.activeTab,onValueChange:a,className:`w-auto min-w-0 flex-1`,children:(0,Z.jsx)(es,{"aria-label":n({id:`task.sideColumn.coverSwitch`}),children:e.tabs.map(e=>(0,Z.jsxs)(Ss,{value:e,"data-testid":`thread-cover-tab-${e}`,children:[Vst(e),(0,Z.jsx)(Ho,{children:o(e)})]},e))})})]})}
function Wst(e){let[t,n]=(0,X.useState)(0);return(0,X.useLayoutEffect)(()=>{let t=e?.querySelector(`:scope > [data-testid="thread-cover-tabs"]`);if(!t)return;let r=()=>n(t.offsetTop+t.offsetHeight);r();let i=typeof ResizeObserver<`u`?new ResizeObserver(r):null;return i?.observe(t),()=>i?.disconnect()},[e]),t}
export {Hst as OfficialThreadCoverTabs,Wst as useOfficialThreadCoverOffset};
