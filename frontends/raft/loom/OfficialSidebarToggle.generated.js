// GENERATED: unchanged locked published Raft toggle declarations. Only dependency/data aliases are adapted.
import * as J from 'react/jsx-runtime';
import {AppShellSidebarTrigger as WBe,AppRailItem as mA,AppRailItemIcon as hA,Kbd as kD} from 'raft-ui';
import {PanelLeftOpen as bCe,PanelLeftClose as vCe} from 'lucide-react';
import XK from '@loom/raft-web-source/Tooltip';
import {useSidebarPreference as gJ,sidebarShortcutLabel as Ppt,sidebarShortcutKeys as Fpt} from './sidebar-preference';
import {useNavigationIntl as Z} from './navigation-preferences';
const j6={right:{side:'right'}};
var ZTt=`app-sidebar`;
var QTt=`app-sidebar-toggle`;
function $Tt(e=document){let{sidebarHidden:t,setSidebarHidden:n}=gJ.getState();if(!t){let t=e.getElementById(ZTt);t&&t.contains(e.activeElement)&&e.getElementById(QTt)?.focus()}n(!t)}
function lEt(){let{formatMessage:e}=Z(),t=gJ(e=>e.sidebarHidden),n=e({id:t?`layout.leftRail.expandSidebar`:`layout.leftRail.collapseSidebar`});return(0,J.jsx)(XK,{content:(0,J.jsxs)(`span`,{className:`flex items-center gap-2`,children:[n,(0,J.jsx)(kD,{"aria-hidden":`true`,children:Ppt(void 0,e)})]}),contentProps:j6.right,children:(0,J.jsx)(WBe,{render:(0,J.jsx)(mA,{className:`size-10 [@media(max-height:600px)]:h-9 [@media(max-height:600px)]:w-9`}),id:QTt,"aria-label":n,"aria-controls":ZTt,"aria-keyshortcuts":Fpt(),title:void 0,"data-testid":`left-rail-sidebar-toggle`,children:(0,J.jsx)(hA,{children:t?(0,J.jsx)(bCe,{size:18,"aria-hidden":`true`}):(0,J.jsx)(vCe,{size:18,"aria-hidden":`true`})})})})}
export {lEt as OfficialSidebarToggle,$Tt as toggleSidebar};
