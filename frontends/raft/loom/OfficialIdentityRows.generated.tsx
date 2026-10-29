// GENERATED from locked db5e399 MemberAgentRow and Sidebar.ComputerRowBody JSX.
// Loom supplies identity, observed/aggregate presence and callbacks. Role has no instance runtime or DM/context actions.
import type {ReactNode,ReactElement} from "react";
import {SidebarItem,SidebarItemIcon,SidebarItemMeta,SidebarItemSubtitle,SidebarItemContent,SidebarItemTitle} from "raft-ui";
import {Monitor} from "lucide-react";
import AvatarSlot from "./OfficialAvatarSlot.generated";
import {sidebarItemClass139 as sidebarItemClass} from "./OfficialSidebar139.generated.js";
const SIDEBAR_ROW_PHONE_CLASS = "max-md:h-auto max-md:min-h-11 max-md:py-[8.5px] max-md:text-body max-md:font-semibold";
export const SIDEBAR_ROW_TRAILING_CLASS = "flex min-w-0 max-w-[58%] flex-initial items-center gap-1.5";
export function OfficialComputerRow({machine,selected,onClick:handleClick,statusDot,statusLabel}:{machine:{id:string;name:string;description?:string|null};selected:boolean;onClick:()=>void;statusDot:ReactNode;statusLabel:ReactNode}){return (<SidebarItem
      wrap
      onClick={handleClick}
      data-slot="sidebar-item"
      active={selected}
      data-testid="computer-desktop-row"
      className={`text-left ${SIDEBAR_ROW_PHONE_CLASS}`}
    >
      <SidebarItemIcon className="relative overflow-visible">
        <Monitor />
        {statusDot}
      </SidebarItemIcon>
      <div className="min-w-0 flex-1">
        <div className="flex items-center">
          <span className="min-w-0 truncate">{machine.name}</span>
        </div>
        {machine.description && (
          <SidebarItemSubtitle className="mt-0.5">
            {machine.description}
          </SidebarItemSubtitle>
        )}
        <SidebarItemMeta className="mt-0.5 flex items-center gap-1.5">{statusLabel}</SidebarItemMeta>
      </div>
    </SidebarItem>);}
export function OfficialRoleRow({agent,selected,busy,onSelect,statusDot}:{agent:{id:string;name:string;displayName?:string;avatarUrl?:string;description?:string;runtimeLabel?:string};selected:boolean;busy:boolean;onSelect:(id:string)=>void;statusDot:ReactElement}){const menuOpen=false;const handleClick=()=>onSelect(agent.id);return (<SidebarItem
      data-role-id={agent.id} aria-label={agent.name} disabled={busy}
      onClick={handleClick}
      data-slot="sidebar-item"
      active={selected}
      className={sidebarItemClass(selected, menuOpen)}
    >
      <AvatarSlot
        context="sidebar-list"
        type="agent"
        agentAvatarUrl={agent.avatarUrl}
        badge={statusDot}
      />
      {/* raft-ui's row content, as every sidebar row: one line, an ellipsis. */}
      <SidebarItemContent>
        <SidebarItemTitle>{agent.displayName || agent.name}</SidebarItemTitle>
        {agent.description && (
          <SidebarItemSubtitle data-sidebar-row-description="">{agent.description}</SidebarItemSubtitle>
        )}
      </SidebarItemContent>
      {/* Runtime in mono, or what it is doing while it works (DS `rf-srow__meta`). */}
      <span className={SIDEBAR_ROW_TRAILING_CLASS}>
        {agent.runtimeLabel && (<SidebarItemMeta className="whitespace-nowrap" data-testid="sidebar-agent-runtime" aria-hidden="true">
      {agent.runtimeLabel}
    </SidebarItemMeta>)}
      </span>
    </SidebarItem>);}
