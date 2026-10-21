import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export function generateComposerView() {
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/message/MessageInput.tsx",
    "utf8",
  );
  const file = ts.createSourceFile(
    "composer.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const nodes = [];
  function walk(n) {
    if (
      ts.isJsxElement(n) &&
      n.openingElement.tagName.getText(file) === "Composer"
    )
      nodes.push(n);
    ts.forEachChild(n, walk);
  }
  walk(file);
  if (nodes.length !== 1) throw Error("Composer boundary changed");
  const root = nodes[0];
  const inputs = [],
    slots = [];
  function scan(n) {
    if (
      ts.isJsxSelfClosingElement(n) &&
      n.tagName.getText(file) === "ComposerInput"
    )
      inputs.push(n);
    if (
      ts.isJsxExpression(n) &&
      n.expression &&
      n.expression.getText(file).startsWith('variant === "compact"')
    )
      slots.push(n);
    ts.forEachChild(n, scan);
  }
  scan(root);
  if (inputs.length !== 1 || slots.length !== 1)
    throw Error("Composer slots changed");
  let view = root
    .getText(file)
    .replace(
      inputs[0].getText(file),
      '<ComposerInput {...input} data-testid="composer-textarea" rows={1} />',
    )
    .replace(
      slots[0].getText(file),
      slots[0].getText(file).replace("<div />", "fileTools"),
    );
  return `// GENERATED from immutable Raft db5e399 MessageInput Composer subtree. Loom owns callbacks and file authority.\nimport type {ComponentProps,ReactNode} from "react";import {useIntl} from "react-intl";import {Composer,ComposerInput,ComposerToolbar,ComposerToolbarLabel,ComposerSubmit,CheckboxIndicator,ComposerActions,ComposerIconButton} from "raft-ui";import {ImagePlus,Paperclip} from "lucide-react";import Tooltip from "@loom/raft-web-source/Tooltip";
export default function OfficialComposerView({input,fileTools,variant,preventToolbarButtonPointerDownBlur,handleAttachImageClick,handleAttachFileClick,showTaskButton,alsoCreateTask,preventTaskTogglePointerDownBlur,toggleTaskModeWithoutBlur,submitTitle,preventSendButtonPointerDownBlur,submitBlocked,submitLabel,submitIcon}:{input:ComponentProps<typeof ComposerInput>;fileTools:ReactNode;variant:"full"|"compact";preventToolbarButtonPointerDownBlur:ComponentProps<typeof ComposerIconButton>["onPointerDown"];handleAttachImageClick:()=>void;handleAttachFileClick:()=>void;showTaskButton:boolean|undefined;alsoCreateTask:boolean;preventTaskTogglePointerDownBlur:ComponentProps<typeof ComposerToolbarLabel>["onPointerDown"];toggleTaskModeWithoutBlur:ComponentProps<typeof ComposerToolbarLabel>["onClick"];submitTitle:string;preventSendButtonPointerDownBlur:ComponentProps<typeof ComposerSubmit>["onPointerDown"];submitBlocked:boolean;submitLabel:string;submitIcon:ReactNode}){const {formatMessage}=useIntl();return (${view});}\n`;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeFileSync(
    "frontends/raft/loom/OfficialComposerView.generated.tsx",
    generateComposerView(),
  );
