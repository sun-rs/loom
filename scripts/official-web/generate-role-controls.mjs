import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
function one(s, p) {
  const a = ts.createSourceFile("s.tsx", s, 99, true, 4),
    m = [];
  function visit(n) {
    if (p(n, a)) m.push(n);
    ts.forEachChild(n, visit);
  }
  visit(a);
  if (m.length !== 1) throw Error("Role controls source drift " + m.length);
  return m[0].getText(a);
}
export function generateRoleControls() {
  const s = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/agent/AgentDetailPanel.tsx",
    "utf8",
  );
  let modal = one(
    s,
    (n, a) =>
      ts.isJsxElement(n) &&
      n.openingElement.tagName.getText(a) === "Modal" &&
      n.getText(a).includes('data-testid="agent-runtime-config-dialog"'),
  );
  const form = one(
    modal,
    (n, a) =>
      ts.isJsxElement(n) && n.openingElement.tagName.getText(a) === "form",
  );
  modal = modal
    .replace(form, "{children}")
    .replace("ref={runtimeConfigModalRef}", "ref={containerRef}")
    .replace(
      '{formatMessage({ id: "agent.detail.editRuntimeConfig" })}',
      "编辑运行时配置",
    )
    .replaceAll("closeRuntimeConfigEditor", "onClose");
  let button = one(
    s,
    (n, a) =>
      ts.isJsxElement(n) &&
      n.openingElement.tagName.getText(a) === "Button" &&
      n.openingElement.getText(a).includes("onClick={openResetDialog}"),
  );
  const opening = button
    .slice(0, button.indexOf(">") + 1)
    .replace('variant="outline"', 'variant={danger ? "danger" : "outline"}')
    .replace(
      "onClick={openResetDialog}",
      "onClick={onClick} disabled={disabled}",
    );
  return `// GENERATED from db5e399 AgentDetailPanel runtime modal and reset action button.
// Loom supplies supported runtime fields/actions. No cloud account/provider configuration.
import type {ReactNode,RefObject} from 'react';
import {DialogSurface,Button} from 'raft-ui';
import {X} from 'lucide-react';
import Modal from '@loom/raft-web-source/Modal';
import CloseButton from '@loom/raft-web-source/CloseButton';
export function OfficialRuntimeDialog({onClose,children,containerRef}:{onClose:()=>void;children:ReactNode;containerRef:RefObject<HTMLDivElement|null>}){return (${modal});}
export function OfficialRoleAction({onClick,disabled,danger,children}:{onClick:()=>void;disabled?:boolean;danger?:boolean;children:ReactNode}){return (${opening}{children}</Button>);}
`;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeFileSync(
    "frontends/raft/loom/OfficialRoleControls.generated.tsx",
    generateRoleControls(),
  );
