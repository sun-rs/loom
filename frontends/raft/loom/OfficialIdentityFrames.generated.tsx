// GENERATED from locked db5e399 Sidebar and AgentDetailPanel. Presentation only.
// Explicit Loom slots: single-workspace mobile title/notification, fixed two-tab Role list (no native agent tab reordering).
import type {ReactNode} from "react";
import {SidebarHeader,SidebarHeaderTitle,PanelSectionHeader,PanelHeaderContent,PanelTitle,ConversationPanelTabs,Tabs} from "raft-ui";
export function OfficialSidebarHeader({desktop,title,testId,trailing}:{desktop:boolean;title:string;testId:string;trailing?:ReactNode}){return desktop?(<SidebarHeader data-testid={testId} data-loom-root-header>
            <SidebarHeaderTitle render={<h1 />} className="min-w-0 flex-1">
              {title}
            </SidebarHeaderTitle>
            
          </SidebarHeader>):(<PanelSectionHeader data-testid={testId} data-loom-root-header><PanelHeaderContent>
                <PanelTitle render={<h1 />}>{title}</PanelTitle>
              </PanelHeaderContent>{trailing}</PanelSectionHeader>);}
export function OfficialRoleTabs({value,onValueChange,children}:{value:string;onValueChange:(value:string)=>void;children:ReactNode}){return <div className="min-w-0 max-w-full"><ConversationPanelTabs
          render={<Tabs value={value} onValueChange={onValueChange} />}
        >
          {children}
        </ConversationPanelTabs></div>;}
