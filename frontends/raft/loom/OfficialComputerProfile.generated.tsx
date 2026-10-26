// GENERATED from locked Raft db5e399 declarations. Loom supplies identity/status/runtime data and children.
import type {ReactNode} from "react";
import {useIntl} from "react-intl";
import {IconTile,PanelTitle,Badge,Status,Panel} from "raft-ui";
import {Monitor} from "lucide-react";
import KeyValueRow from "@loom/raft-web-source/KeyValueRow";
export function OfficialComputerProfile({name,hostname,status,label}:{name:string;hostname?:string|null;status:string;label:string}){
 const {formatMessage}=useIntl();
 const machine={name,hostname,status};
 // A draining Loom host keeps its own busy state; no upstream upgrade operation is started.
 const upgradeReconnecting=status==="draining";
 return (<div className="flex items-start gap-4 px-5 py-5">
          <IconTile size="lg">
            <Monitor aria-hidden="true" />
          </IconTile>
          <div className="min-w-0 flex-1 stack-y-1">
            <PanelTitle className="min-w-0">{machine.name}</PanelTitle>
            {/* Raft DS StatusChip: soft wash, square pixel, one word — online
                lime, a web upgrade's reconnect is busy (yellow), offline stone. */}
            <div className="flex min-w-0 items-center gap-2">
              <Badge
                appearance="soft"
                variant={machine.status === "online" ? "success" : upgradeReconnecting ? "primary" : "muted"}
                className="shrink-0"
              >
                <Status
                  size="md"
                  variant={machine.status === "online" ? "success" : upgradeReconnecting ? "primary" : "default"}
                  aria-hidden="true"
                />
                <span data-testid="machine-connection-status">
                  {label}
                </span>
              </Badge>
            </div>
            {machine.hostname && (
              <div className="truncate font-mono text-mono-meta text-foreground-hint">{machine.hostname}</div>
            )}
          </div>
        </div>);
}
// Web1.21.34 MachineDetailPanel lower-body wrapper; children are Loom sections.
export function OfficialComputerSections({children}:{children:ReactNode}){return <div className="px-5 py-4 stack-y-6">{children}</div>;}
export function OfficialComputerRuntimes({children}:{children:ReactNode}){
 const {formatMessage}=useIntl();
 return (<KeyValueRow
              label={formatMessage({ id: "machine.detail.detectedRuntimes" })}
              value={
                <div className="flex items-center gap-1.5 flex-wrap">
                  {children}
                </div>
              }
            />);
}
export function OfficialRoleHero({children,"data-testid":testId}:{children:ReactNode;"data-testid"?:string}){return (<div data-testid={testId} className="flex items-start gap-4 px-5 py-5">{children}</div>);}
export function OfficialRoleIdentity({children,"data-testid":testId}:{children:ReactNode;"data-testid"?:string}){return (<div data-testid={testId} className="min-w-0 flex-1 pt-1">{children}</div>);}
export function OfficialSettingsFrame({children}:{children:ReactNode}){return (<Panel edge="inset" className="flex min-h-0 flex-1 flex-col bg-layer-canvas text-foreground" data-testid="settings-panel-frame">{children}</Panel>);}
export function OfficialSettingsBody({children}:{children:ReactNode}){const settingsTab:string="loom";return (<div className={settingsTab === "feedback"
 ? "min-h-0 flex-1 bg-layer-canvas"
 : "flex-1 overflow-y-auto bg-layer-canvas px-4 py-4 text-foreground mobile-nav-clearance md:px-5"}
      >{children}</div>);}
