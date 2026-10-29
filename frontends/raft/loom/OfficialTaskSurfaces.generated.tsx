// GENERATED from locked db5e399 source; explicit Loom slots/guards, not a second business owner.
import type {ReactNode} from "react";import {useIntl} from "react-intl";import {PanelHeader as PanelHead,PanelAction,PanelActions,DescriptionList,DescriptionItem,DescriptionTerm,DescriptionDetails,DialogSurface,Popover,PopoverTrigger,PickerTriggerButton,TasksPanelToolbar,SegmentedControl,SegmentedControlItem,SegmentedControlLabel,Button,PanelSectionHeader,PanelHeaderContent,PanelTitle,PanelMeta,ThreadIcon} from "raft-ui";import {ArrowLeft,X,Plus,Columns3,LayoutList,ChevronDown,ChevronRight} from "lucide-react";import SectionEyebrow from "@loom/raft-web-source/SectionEyebrow";import Tooltip from "@loom/raft-web-source/Tooltip";import Modal from "@loom/raft-web-source/Modal";import SelectionPopover from "./OfficialTaskSelection.generated";import type {Task} from "../packages/web/src/store/taskStore";
const FILTER_COUNT_CLASS_NAME="font-mono text-mono-meta font-bold";
function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DescriptionItem className="flex min-w-0 items-center gap-2">
      <DescriptionTerm className="mb-0 shrink-0">{label}</DescriptionTerm>
      <DescriptionDetails className="min-w-0">{children}</DescriptionDetails>
    </DescriptionItem>
  );
}
export {PropertyRow as OfficialPropertyRow};
export function OfficialTaskProperties({status,assignee,createdBy,onKeyDownCapture}:{status:ReactNode;assignee:ReactNode;createdBy:ReactNode;onKeyDownCapture:import("react").KeyboardEventHandler<HTMLDListElement>}){const {formatMessage}=useIntl();return (<DescriptionList onKeyDownCapture={onKeyDownCapture}
      className="flex flex-wrap items-center gap-x-6 gap-y-2"
      data-testid="task-properties"
    >
      <PropertyRow label={formatMessage({ id: "task.properties.status" })}>{status}</PropertyRow>

      {/* Same editor as Status, so the property reads the same — but
          `searchable`, so the panel is the search page's SelectionPopover
          rather than a plain list. A server's member list is long and humans
          are assignable too, so this one has to be typed into; Status never
          will be (@stdrc msg=c8c890d2, msg=4c357cb1). */}
      <PropertyRow label={formatMessage({ id: "task.properties.assignee" })}>{assignee}</PropertyRow>

      <PropertyRow label={formatMessage({ id: "task.properties.createdBy" })}>{createdBy}</PropertyRow>
    </DescriptionList>);}
export function OfficialTaskHistoryFrame({historyOpen,toggleHistory,children}:{historyOpen:boolean;toggleHistory:()=>void;children:ReactNode}){const {formatMessage}=useIntl();return (<div className="pt-4"><SectionEyebrow data-testid="task-history-toggle" as="button" className="flex w-full items-center gap-1 rounded-sticker text-left outline-none hover:text-foreground focus-visible:shadow-focus" aria-expanded={historyOpen} onClick={toggleHistory}><span>{formatMessage({ id: "task.properties.history" })}</span>{historyOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}</SectionEyebrow>
      {historyOpen && <div className="mt-3 w-full">{children}</div>}
    </div>);}
function channelSigil(name: string): string {
  return `#${name}`;
}
const NON_INTERACTIVE_TOOLTIP_PROPS = { className: "pointer-events-none" };
function TaskModalBar({
  task,
  onClose,
  onViewInThread,
  mobile = false,
  summary,
}: {
  task: Task;
  onClose: () => void;
  /** Absent when the task has no thread to show (legacy tasks, or a task
   *  whose anchor is itself a thread reply). */
  onViewInThread?: () => void;
  mobile?: boolean;
  summary?: ReactNode;
}) {
  const { formatMessage } = useIntl();
  return (
    // raft-ui PanelHeader owns the edges, as on every other panel head: the
    // last glyph 20px from the edge on desktop, and on a phone the Back
    // mirrors the last action, 3px from the edge. Its row is centred, so the X is
    // weighed against the whole two-line block, not its first line.
    <PanelHead>
      {mobile && (
        <PanelAction
          onClick={onClose}
          aria-label={formatMessage({ id: "task.modal.close" })}
          data-testid="task-modal-mobile-back"
        >
          <ArrowLeft />
        </PanelAction>
      )}
      {/* Two lines so the bar has body: where this lives, then what it is.
          Both are stable facts — the task's own title stays in the scrolling
          body, because a long one cannot be bounded by a fixed bar. */}
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-mono-meta text-foreground-muted" data-testid="task-modal-bar-ref">
          {channelSigil(task.channelName || formatMessage({ id: "task.properties.unknownChannel" }))}
        </div>
        {summary ?? (<div className="truncate text-sm font-bold" data-testid="task-modal-bar-label">
          {formatMessage({ id: "task.modal.taskWithNumber" }, { taskNumber: task.taskNumber })}
        </div>)}
      </div>
      {(onViewInThread || !mobile) && (
        <PanelActions>
          {/* Icon-only, the same quiet control as Close beside it — the shape
              the legacy task panel's "View in channel" already uses (Artea). */}
          {onViewInThread && (
            <Tooltip
              content={formatMessage({ id: "task.modal.viewInThread" })}
              disableHoverablePopup
              contentProps={NON_INTERACTIVE_TOOLTIP_PROPS}
            >
              <PanelAction
                onClick={onViewInThread}
                aria-label={formatMessage({ id: "task.modal.viewInThread" })}
                data-testid="task-modal-view-in-thread"
              >
                <ThreadIcon />
              </PanelAction>
            </Tooltip>
          )}
          {!mobile && (
            <PanelAction
              onClick={onClose}
              aria-label={formatMessage({ id: "task.modal.close" })}
              data-testid="task-modal-close"
            >
              <X />
            </PanelAction>
          )}
        </PanelActions>
      )}
    </PanelHead>
  );
}
export {TaskModalBar as OfficialTaskModalBar};
export function OfficialTaskSurface({mobile,header,children,onClose}:{mobile:boolean;header:ReactNode;children:ReactNode;onClose:()=>void}){return mobile?(<div className="absolute inset-0 z-30 flex flex-col bg-layer-canvas" data-testid="task-thread-modal">
        {header}
        <div className="flex min-h-0 flex-1 flex-col">
          {children}
        </div>
      </div>):<Modal onClose={onClose} closeOnBackdrop><DialogSurface
        className="h-[min(86vh,900px)] max-h-[calc(100dvh-2rem)] w-[min(960px,calc(100vw-2rem))]"
        data-testid="task-thread-modal"
      >
        {header}
        <div className="flex min-h-0 flex-1 flex-col">
          {children}
        </div>
      </DialogSurface></Modal>;}
export function OfficialTaskReadBar({mobile,onClose,label}:{mobile:boolean;onClose:()=>void;label:string}){return <PanelHead>{mobile&&<PanelAction onClick={onClose} aria-label="关闭任务" data-testid="task-modal-mobile-back"><ArrowLeft/></PanelAction>}<div className="min-w-0 flex-1">{label}</div>{!mobile&&<PanelActions><PanelAction onClick={onClose} aria-label="关闭任务" data-testid="task-modal-close"><X/></PanelAction></PanelActions>}</PanelHead>;}
export function OfficialTaskFilter({label,icon,selected,isOpen,handleOpenChange,search,setSearch,popoverOptions,clearSelection,disabled}:ReturnType<typeof import("./TaskFilterPicker").useTaskFilterController>){return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={<PickerTriggerButton disabled={disabled} aria-label={`筛选${label}`} type="button" data-has-value={selected.length > 0 ? "" : undefined} />}
      >
        {icon}
        {label}
        {selected.length > 0 && (
          <span className={FILTER_COUNT_CLASS_NAME}>{selected.length}</span>
        )}
        <span data-picker-trigger-indicator="" aria-hidden="true">
          <ChevronDown />
        </span>
      </PopoverTrigger>
      <SelectionPopover
        testId={`task-filter-${label}`}
        title={label}
        searchable
        search={search}
        onSearchChange={setSearch}
        options={popoverOptions}
        showClear={selected.length > 0}
        onClear={clearSelection}
      />
    </Popover>
  );}
export function OfficialTaskToolbar({filters,isChannelMode,canModifyTasks,openCreateDialog,viewMode,setView}:{filters:ReactNode;isChannelMode:boolean;canModifyTasks:boolean;openCreateDialog:()=>void;viewMode:string;setView:(value:string)=>void}){const {formatMessage}=useIntl();return (<TasksPanelToolbar>
        <div className="flex flex-wrap items-center gap-2">
          {filters}
          {/* New Task button: channel mode only. Server-wide page has no
              implicit channel context to anchor task creation, so we don't
              expose a +New CTA there — users still create from the channel
              they want the task in. */}
          {isChannelMode && canModifyTasks && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={openCreateDialog}
            >
              <Plus size={16} />
              {formatMessage({ id: "task.board.newTask" })}
            </Button>
          )}

          <SegmentedControl
            value={viewMode}
            onValueChange={setView}
            aria-label={formatMessage({ id: "task.viewAria" })}
            className="@min-md/tasks:ml-auto"
          >
            {/* Phone: icons only; the label stays as the accessible name. */}
            <SegmentedControlItem
              value="board"
              data-testid="channel-task-view-board"
            >
              <Columns3 size={16} aria-hidden="true" />
              <SegmentedControlLabel className="max-sm:sr-only">{formatMessage({ id: "task.view.board" })}</SegmentedControlLabel>
            </SegmentedControlItem>
            <SegmentedControlItem
              value="list"
              data-testid="channel-task-view-list"
            >
              <LayoutList size={16} aria-hidden="true" />
              <SegmentedControlLabel className="max-sm:sr-only">{formatMessage({ id: "task.view.list" })}</SegmentedControlLabel>
            </SegmentedControlItem>
          </SegmentedControl>
        </div>
      </TasksPanelToolbar>);}
export function OfficialTasksHeader({meta}:{meta:ReactNode}){const {formatMessage}=useIntl();return (<PanelSectionHeader data-loom-root-header>
          <PanelHeaderContent>
            <PanelTitle render={<h2>{formatMessage({ id: "task.panel.heading" })}</h2>} />
            <PanelMeta render={<p />}>{meta}</PanelMeta>
          </PanelHeaderContent>
        </PanelSectionHeader>);}
