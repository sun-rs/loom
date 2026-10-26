import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDeclarations } from "./generate-appearance.mjs";
const base =
  "frontends/raft/upstream/raft-web-source/packages/web/src/components/";
const header =
  "// GENERATED from locked db5e399 source; explicit Loom slots/guards, not a second business owner.\n";
function parsed(path) {
  const source = readFileSync(base + path + ".tsx", "utf8");
  return {
    source,
    file: ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  };
}
function one(file, predicate) {
  const nodes = [];
  function walk(n) {
    if (predicate(n)) nodes.push(n);
    ts.forEachChild(n, walk);
  }
  walk(file);
  if (nodes.length !== 1)
    throw Error("Source boundary changed: " + nodes.length);
  return nodes[0];
}
function replace(s, a, b) {
  if (s.split(a).length !== 2) throw Error("Missing/ambiguous boundary " + a);
  return s.replace(a, b);
}
function tag(n, name) {
  return ts.isJsxElement(n) && n.openingElement.tagName.getText() === name;
}
export function generateCloseout() {
  const task = parsed("task/TasksPanel"),
    main = parsed("layout/MainLayout"),
    activity = parsed("thread/ThreadsInbox"),
    create = parsed("task/CreateTaskDialog");
  let selection = readFileSync(base + "ui/SelectionPopover.tsx", "utf8")
    .replace('"@botiverse/raft-ui"', '"raft-ui"')
    .replace(
      '"./dismissLayer"',
      '"../upstream/raft-web-source/packages/web/src/components/ui/dismissLayer"',
    );
  selection = replace(
    selection,
    "type SelectionPopoverProps = SelectionPopoverPanelProps & {",
    "type SelectionPopoverProps = SelectionPopoverPanelProps & {\n  testId?: string;",
  );
  selection = replace(
    selection,
    "export default function SelectionPopover({",
    "export default function SelectionPopover({\n  testId,",
  );
  selection = replace(
    selection,
    "    <PopoverContent\n",
    "    <PopoverContent\n      data-testid={testId}\n",
  );
  const chip = one(
    task.file,
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "IdentityFilterChip",
  );
  const ret = one(
    chip,
    (n) =>
      ts.isReturnStatement(n) &&
      n.expression &&
      n.expression.getText(task.file).startsWith("(\n    <Popover"),
  );
  let picker = ret.expression.getText(task.file);
  picker = replace(
    picker,
    '<PickerTriggerButton type="button"',
    '<PickerTriggerButton disabled={disabled} aria-label={`筛选${label}`} type="button"',
  );
  picker = replace(
    picker,
    "<SelectionPopover\n",
    "<SelectionPopover\n        testId={`task-filter-${label}`}\n",
  );
  let toolbar = one(task.file, (n) => tag(n, "TasksPanelToolbar")).getText(
    task.file,
  );
  const start = toolbar.indexOf("          {/* Channel filter");
  const end = toolbar.indexOf("          {/* New Task button");
  if (start < 0 || end < start) throw Error("toolbar slots changed");
  toolbar =
    toolbar.slice(0, start) + "          {filters}\n" + toolbar.slice(end);
  // Web 1.21.34 TasksPanel: align by task container, not viewport.
  toolbar = replace(
    toolbar,
    'className="sm:ml-auto"',
    'className="@min-md/tasks:ml-auto"',
  );
  const mainHeader = one(task.file, (n) =>
    tag(n, "PanelSectionHeader"),
  ).getText(task.file);
  const meta = one(task.file, (n) => tag(n, "PanelMeta")).getText(task.file);
  const pageHeader = replace(
    replace(
      mainHeader,
      "<PanelSectionHeader>",
      "<PanelSectionHeader data-loom-root-header>",
    ),
    meta,
    "<PanelMeta render={<p />}>{meta}</PanelMeta>",
  );
  let createView = one(create.file, (n) => tag(n, "DialogCard")).getText(
    create.file,
  );
  createView = replace(
    createView,
    "<DialogCard title=",
    '<DialogCard testId="loom-create-tasks" title=',
  );
  createView = replace(
    createView,
    "          <div>\n            {titles.map",
    '          {verification}\n          <fieldset disabled={submitting} className="min-w-0 space-y-4">\n          <div>\n            {titles.map',
  );
  createView = replace(
    createView,
    "        </form>",
    "          </fieldset>\n        </form>",
  );
  const properties = parsed("task/TaskProperties");
  const propertyRow = extractDeclarations(properties.source, [
    "PropertyRow",
  ]).join("\n");
  const propertyList = one(properties.file, (n) => tag(n, "DescriptionList"));
  let propertyView = propertyList.getText(properties.file);
  const rows = propertyList.children.filter((n) => tag(n, "PropertyRow"));
  if (rows.length !== 3) throw Error("Property row boundary changed");
  for (const [index, slot] of ["status", "assignee", "createdBy"].entries()) {
    const row = rows[index];
    const text = row.getText(properties.file);
    propertyView = replace(
      propertyView,
      text,
      row.openingElement.getText(properties.file) +
        "{" +
        slot +
        "}" +
        row.closingElement.getText(properties.file),
    );
  }
  propertyView = replace(
    propertyView,
    "<DescriptionList",
    "<DescriptionList onKeyDownCapture={onKeyDownCapture}",
  );
  let history = one(
    properties.file,
    (n) =>
      tag(n, "div") &&
      n.openingElement.getText(properties.file) === '<div className="pt-4">',
  ).getText(properties.file);
  const historyNode = one(
    properties.file,
    (n) =>
      ts.isJsxExpression(n) &&
      n.getText(properties.file).startsWith("{historyOpen && <div"),
  );
  history = replace(
    history,
    historyNode.getText(properties.file),
    '{historyOpen && <div className="mt-3 w-full">{children}</div>}',
  );
  history = replace(
    history,
    '<SectionEyebrow as="button"',
    '<SectionEyebrow data-testid="task-history-toggle" as="button"',
  );
  const bar = extractDeclarations(main.source, [
    "channelSigil",
    "NON_INTERACTIVE_TOOLTIP_PROPS",
    "TaskModalBar",
  ]).join("\n");
  function surface(mobile) {
    const node = one(
      main.file,
      (n) =>
        tag(n, mobile ? "div" : "DialogSurface") &&
        n.openingElement
          .getText(main.file)
          .includes('data-testid="task-thread-modal"'),
    );
    let view = node.getText(main.file);
    const barNode = one(
      node,
      (n) =>
        ts.isJsxExpression(n) &&
        n.getText(main.file).includes("hostTask &&") &&
        n.getText(main.file).includes("<TaskModalBar"),
    );
    view = replace(view, barNode.getText(main.file), "{header}");
    const threadNode = one(
      node,
      (n) =>
        ts.isJsxSelfClosingElement(n) &&
        n.tagName.getText(main.file) === "ThreadPanel",
    );
    view = replace(view, threadNode.getText(main.file), "{children}");
    return view;
  }
  const activityHeader = one(
    activity.file,
    (n) =>
      ts.isJsxSelfClosingElement(n) &&
      n.tagName.getText(activity.file) === "PanelHeader",
  ).getText(activity.file);
  const activityAction = one(
    activity.file,
    (n) =>
      tag(n, "Tooltip") &&
      n.getText(activity.file).includes('data-testid="inbox-mark-all-read"'),
  ).getText(activity.file);
  let ah = replace(
    activityHeader,
    "        title=",
    "        actions={actions}\n        title=",
  );
  ah = replace(
    ah,
    "onMobileBack={onMobileBack}",
    "onMobileBack={onMobileBack}\n        mobileBackProps={mobileBackProps}",
  );
  ah = replace(
    ah,
    'subtitle={formatMessage({ id: "thread.header.subtitle" }, { activeCount: totalCount, unreadCount: totalUnreadCount })}',
    'subtitle={typeof totalCount === "number" && typeof totalUnreadCount === "number" ? formatMessage({ id: "thread.header.subtitle" }, { activeCount: totalCount, unreadCount: totalUnreadCount }) : unknownSubtitle}',
  );
  let aa = replace(
    activityAction,
    "                    onClick={handleMarkAllRead}",
    "                    disabled={busy}\n                    onClick={handleMarkAllRead}",
  );
  // 1.21.34 ThreadsInbox yn: narrow toolbar mark-all action becomes CheckCheck.
  aa = replace(aa, 'size="sm"', 'size="md"');
  aa = replace(
    aa,
    'className="shrink-0 whitespace-nowrap"',
    'className="-mr-[calc(--spacing(3)+1.5px)] shrink-0 whitespace-nowrap @max-[30rem]:-mr-2 @max-[30rem]:size-8 @max-[30rem]:px-0"',
  );
  aa = replace(
    aa,
    '{formatMessage({ id: "thread.markAllRead.label" })}',
    '<CheckCheck aria-hidden className="hidden @max-[30rem]:block" /><span className="@max-[30rem]:sr-only">{formatMessage({ id: "thread.markAllRead.label" })}</span>',
  );
  return {
    "OfficialTaskSelection.generated.tsx": header + selection,
    "OfficialTaskCreate.generated.tsx":
      header +
      `import {useIntl} from "react-intl";import {Button} from "raft-ui";import {Plus} from "lucide-react";import DialogCard from "@loom/raft-web-source/DialogCard";import Banner from "@loom/raft-web-source/Banner";import {TaskTitleRow} from "@loom/raft-web-source/TaskTitleRow";import {useTaskCreation} from "./TaskCreate";
export default function CreateTaskDialog({channelId,onClose:requestClose}:{channelId:string;onClose:()=>void}){const {formatMessage}=useIntl();const {titles,error,submitting,isBatch,onClose,handleSubmit,updateTitle,addRow,removeRow,verification}=useTaskCreation(channelId,requestClose);return (${createView});}\n`,
    "OfficialTaskSurfaces.generated.tsx":
      header +
      `import type {ReactNode} from "react";import {useIntl} from "react-intl";import {PanelHeader as PanelHead,PanelAction,PanelActions,DescriptionList,DescriptionItem,DescriptionTerm,DescriptionDetails,DialogSurface,Popover,PopoverTrigger,PickerTriggerButton,TasksPanelToolbar,SegmentedControl,SegmentedControlItem,SegmentedControlLabel,Button,PanelSectionHeader,PanelHeaderContent,PanelTitle,PanelMeta,ThreadIcon} from "raft-ui";import {ArrowLeft,X,Plus,Columns3,LayoutList,ChevronDown,ChevronRight} from "lucide-react";import SectionEyebrow from "@loom/raft-web-source/SectionEyebrow";import Tooltip from "@loom/raft-web-source/Tooltip";import Modal from "@loom/raft-web-source/Modal";import SelectionPopover from "./OfficialTaskSelection.generated";import type {Task} from "../packages/web/src/store/taskStore";
const FILTER_COUNT_CLASS_NAME="font-mono text-mono-meta font-bold";
${propertyRow}
export {PropertyRow as OfficialPropertyRow};
export function OfficialTaskProperties({status,assignee,createdBy,onKeyDownCapture}:{status:ReactNode;assignee:ReactNode;createdBy:ReactNode;onKeyDownCapture:import("react").KeyboardEventHandler<HTMLDListElement>}){const {formatMessage}=useIntl();return (${propertyView});}
export function OfficialTaskHistoryFrame({historyOpen,toggleHistory,children}:{historyOpen:boolean;toggleHistory:()=>void;children:ReactNode}){const {formatMessage}=useIntl();return (${history});}
${bar}
export {TaskModalBar as OfficialTaskModalBar};
export function OfficialTaskSurface({mobile,header,children,onClose}:{mobile:boolean;header:ReactNode;children:ReactNode;onClose:()=>void}){return mobile?(${surface(true)}):<Modal onClose={onClose} closeOnBackdrop>${surface(false)}</Modal>;}
export function OfficialTaskReadBar({mobile,onClose,label}:{mobile:boolean;onClose:()=>void;label:string}){return <PanelHead>{mobile&&<PanelAction onClick={onClose} aria-label="关闭任务" data-testid="task-modal-mobile-back"><ArrowLeft/></PanelAction>}<div className="min-w-0 flex-1">{label}</div>{!mobile&&<PanelActions><PanelAction onClick={onClose} aria-label="关闭任务" data-testid="task-modal-close"><X/></PanelAction></PanelActions>}</PanelHead>;}
export function OfficialTaskFilter({label,icon,selected,isOpen,handleOpenChange,search,setSearch,popoverOptions,clearSelection,disabled}:ReturnType<typeof import("./TaskFilterPicker").useTaskFilterController>){return ${picker};}
export function OfficialTaskToolbar({filters,isChannelMode,canModifyTasks,openCreateDialog,viewMode,setView}:{filters:ReactNode;isChannelMode:boolean;canModifyTasks:boolean;openCreateDialog:()=>void;viewMode:string;setView:(value:string)=>void}){const {formatMessage}=useIntl();return (${toolbar});}
export function OfficialTasksHeader({meta}:{meta:ReactNode}){const {formatMessage}=useIntl();return (${pageHeader});}
`,
    "OfficialActivityHeader.generated.tsx":
      header +
      `import {CheckCheck} from "lucide-react";import type {ReactNode,ComponentProps} from "react";import {useIntl} from "react-intl";import {Button} from "raft-ui";import PanelHeader from "../packages/web/src/components/ui/PanelHeader";import SectionEyebrow from "@loom/raft-web-source/SectionEyebrow";import Tooltip from "@loom/raft-web-source/Tooltip";
export function OfficialActivityHeader({totalCount,totalUnreadCount,unknownSubtitle,onMobileBack,mobileBackProps,headerContainerProps,headerTitleClickProps,actions}:{totalCount:number|undefined;totalUnreadCount:number|undefined;unknownSubtitle?:string;onMobileBack:()=>void;mobileBackProps:ComponentProps<typeof PanelHeader>["mobileBackProps"];headerContainerProps:ComponentProps<typeof PanelHeader>["containerProps"];headerTitleClickProps:ComponentProps<typeof PanelHeader>["titleClickProps"];actions:ReactNode}){const {formatMessage}=useIntl();return (${ah});}
export function OfficialActivityMarkAll({busy,handleMarkAllRead}:{busy:boolean;handleMarkAllRead:()=>void}){const {formatMessage}=useIntl();return (${aa});}
`,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  for (const [name, source] of Object.entries(generateCloseout()))
    writeFileSync("frontends/raft/loom/" + name, source);
