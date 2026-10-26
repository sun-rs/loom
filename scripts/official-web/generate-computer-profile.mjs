import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const base =
  "frontends/raft/upstream/raft-web-source/packages/web/src/components/";
function node(source, predicate) {
  const ast = ts.createSourceFile("upstream.tsx", source, 99, true, 4),
    matches = [];
  function walk(n) {
    if (predicate(n, ast)) matches.push(n);
    ts.forEachChild(n, walk);
  }
  walk(ast);
  if (matches.length !== 1)
    throw Error("Profile source boundary changed: " + matches.length);
  return matches[0].getText(ast);
}
export function generateComputerProfile() {
  const s = readFileSync(base + "machine/MachineDetailPanel.tsx", "utf8");
  const hero = node(
    s,
    (n, a) =>
      ts.isJsxElement(n) &&
      n.openingElement.getText(a) ===
        '<div className="flex items-start gap-4 px-5 py-5">',
  );
  const statusText = node(
    hero,
    (n, a) =>
      ts.isJsxExpression(n) &&
      n.getText(a).includes('id: "machine.detail.connected"'),
  );
  const runtime = node(
    s,
    (n, a) =>
      ts.isJsxSelfClosingElement(n) &&
      n.tagName.getText(a) === "KeyValueRow" &&
      n.getText(a).includes('id: "machine.detail.detectedRuntimes"'),
  );
  const runtimeMap = node(
    runtime,
    (n, a) =>
      ts.isJsxExpression(n) &&
      n.getText(a).startsWith("{getMachineRuntimeDisplayOptions().map"),
  );
  const agent = readFileSync(base + "agent/AgentDetailPanel.tsx", "utf8");
  const roleHero = node(
    agent,
    (n, a) =>
      ts.isJsxOpeningElement(n) &&
      n.getText(a) === '<div className="flex items-start gap-4 px-5 py-5">',
  );
  const roleIdentity = node(
    agent,
    (n, a) =>
      ts.isJsxOpeningElement(n) &&
      n.getText(a) === '<div className="min-w-0 flex-1 pt-1">',
  );
  const settings = readFileSync(base + "settings/SettingsPanel.tsx", "utf8");
  const frame = node(
    settings,
    (n, a) =>
      ts.isJsxOpeningElement(n) &&
      n.tagName.getText(a) === "Panel" &&
      n.getText(a).includes('data-testid="settings-panel-frame"'),
  );
  const body = node(
    settings,
    (n, a) =>
      ts.isJsxOpeningElement(n) &&
      n.tagName.getText(a) === "div" &&
      n.getText(a).includes('className={settingsTab === "feedback"'),
  );
  return `// GENERATED from locked Raft db5e399 declarations. Loom supplies identity/status/runtime data and children.
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
 return (${hero.replace(statusText, "{label}").replace("min-w-0 flex-1 space-y-1", "min-w-0 flex-1 stack-y-1")});
}
// Web1.21.34 MachineDetailPanel lower-body wrapper; children are Loom sections.
export function OfficialComputerSections({children}:{children:ReactNode}){return <div className="px-5 py-4 stack-y-6">{children}</div>;}
export function OfficialComputerRuntimes({children}:{children:ReactNode}){
 const {formatMessage}=useIntl();
 return (${runtime.replace(runtimeMap, "{children}")});
}
export function OfficialRoleHero({children,"data-testid":testId}:{children:ReactNode;"data-testid"?:string}){return (${roleHero.replace("<div ", "<div data-testid={testId} ")}{children}</div>);}
export function OfficialRoleIdentity({children,"data-testid":testId}:{children:ReactNode;"data-testid"?:string}){return (${roleIdentity.replace("<div ", "<div data-testid={testId} ")}{children}</div>);}
export function OfficialSettingsFrame({children}:{children:ReactNode}){return (${frame}{children}</Panel>);}
export function OfficialSettingsBody({children}:{children:ReactNode}){const settingsTab:string="loom";return (${body}{children}</div>);}
`;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeFileSync(
    "frontends/raft/loom/OfficialComputerProfile.generated.tsx",
    generateComputerProfile(),
  );
