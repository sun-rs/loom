// GENERATED from locked db5e399 ChannelOverflowMenu/ChannelMembers. Original JSX;
// imports, activity badge, create callback and typed data slots bind Loom. No upstream stores.
import {useCallback,useState,useSyncExternalStore} from 'react';
import type {ReactNode,ReactElement,ChangeEvent,MouseEvent} from 'react';
import {useIntl} from 'react-intl';
import {AlertTriangle,ArrowLeft,ChevronRight,Plus,Search,Users,UserMinus,X} from 'lucide-react';
import type {Presence} from 'raft-ui';
import {Badge,Button,Card,Spinner,Skeleton,TooltipProvider,PanelHeader,PanelAction,InputGroup,InputGroupAddon,InputGroupInput,CheckboxIndicator,SidebarSection,SidebarSectionHeader,SidebarSectionDisclosure,SidebarSectionChevron,SidebarSectionTitle,SidebarSectionCount,SidebarList} from 'raft-ui';
import AvatarSlot from '../packages/web/src/components/ui/AvatarSlot.tsx';
import SectionEyebrow from '@loom/raft-web-source/SectionEyebrow';
import Tooltip from '@loom/raft-web-source/Tooltip';
import Banner from '@loom/raft-web-source/Banner';
import EmptyState from '@loom/raft-web-source/EmptyState';
import FormField from '../packages/web/src/components/ui/FormField.tsx';
export type Member={id:string;name:string;displayName?:string;description?:string;avatarUrl?:string|null;gravatarHash?:string|null;badge?:ReactNode;presence?:Presence;userId?:string;handles?:string[]};
type ChannelAgent=Member;type ChannelHuman=Member;type ChannelExternalMember=Member & {displayName:string};
const STRIP_MAX_ROWS = 3;
const STRIP_TILE_SIZE_PX = 35;
const STRIP_TILE_GAP_PX = 8;
const STRIP_FALLBACK_COLUMNS = 7;
const STRIP_TILE_BUTTON_CLASS = "shrink-0 rounded-sticker outline-none focus-visible:shadow-focus";
export const MEMBERS_STRIP_TOOLTIP_DELAY_MS = 250;
const NO_CHANNEL_EXTERNAL_MEMBERS: ChannelExternalMember[] = [];
function MemberStripTooltip({
  children,
  label,
}: {
  children: ReactElement;
  label: string;
}) {
  return (
    <Tooltip
      content={label}
    >
      {children}
    </Tooltip>
  );
}
function getStripColumnCount(width: number): number {
  if (width <= 0) return STRIP_FALLBACK_COLUMNS;
  return Math.max(1, Math.floor(
    (width + STRIP_TILE_GAP_PX) / (STRIP_TILE_SIZE_PX + STRIP_TILE_GAP_PX),
  ));
}
function getVisibleMemberLimit(total: number, columnCount: number): number {
  const capacity = STRIP_MAX_ROWS * columnCount;
  // The add slot is always visible. Once members overflow, reserve one more
  // slot for +N so the strip never spills into a fourth row.
  return total + 1 <= capacity
    ? total
    : Math.max(0, capacity - 2);
}
function createStripColumnStore() {
  let columnCount = STRIP_FALLBACK_COLUMNS;
  let observer: ResizeObserver | null = null;
  const listeners = new Set<() => void>();

  const measure = (width: number) => {
    if (width <= 0) return;
    const nextColumnCount = getStripColumnCount(width);
    if (nextColumnCount === columnCount) return;
    columnCount = nextColumnCount;
    for (const listener of listeners) listener();
  };

  return {
    attach(grid: HTMLDivElement | null) {
      observer?.disconnect();
      observer = null;
      if (!grid) return;
      measure(grid.getBoundingClientRect().width);
      if (typeof ResizeObserver === "undefined") return;
      observer = new ResizeObserver((entries) => {
        measure(entries[0]?.contentRect.width ?? grid.getBoundingClientRect().width);
      });
      observer.observe(grid);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => columnCount,
    getServerSnapshot: () => STRIP_FALLBACK_COLUMNS,
  };
}
export function MembersStrip({
  channelAgents,
  channelHumans,
  channelExternalMembers = NO_CHANNEL_EXTERNAL_MEMBERS,
  loading,
  onOpen,
  onAdd,
}: {
  channelAgents: ChannelAgent[];
  channelHumans: ChannelHuman[];
  /** Slack participants of a bridged channel (display-only, never Raft members). */
  channelExternalMembers?: ChannelExternalMember[];
  loading: boolean;
  onOpen: () => void;
  onAdd?: () => void;
}) {
  const { formatMessage } = useIntl();
  const [columnStore] = useState(createStripColumnStore);
  const columnCount = useSyncExternalStore(
    columnStore.subscribe,
    columnStore.getSnapshot,
    columnStore.getServerSnapshot,
  );
  const totalMembers = channelHumans.length + channelAgents.length + channelExternalMembers.length;
  const visibleMemberLimit = getVisibleMemberLimit(totalMembers, columnCount);
  const humans = channelHumans.slice(0, visibleMemberLimit);
  const agents = channelAgents.slice(0, Math.max(0, visibleMemberLimit - humans.length));
  const externalMembers = channelExternalMembers.slice(
    0,
    Math.max(0, visibleMemberLimit - humans.length - agents.length),
  );
  const overflow = totalMembers - humans.length - agents.length - externalMembers.length;
  // Machine text (the remaining count), kept out of JSX as a protocol literal.
  const overflowLabel = `+${overflow}`;

  return (
    <div className="px-4 pb-3 pt-3" data-testid="channel-overflow-members-strip">
      {/* DS drawer section: a 13/18 700 ink-2 heading; the entry into the
          full member page is the whole heading row, with its count in ink-3. */}
      <button
        type="button"
        onClick={onOpen}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-2 rounded-control px-2 py-1 text-left outline-none hover:bg-fill-pressed focus-visible:shadow-focus"
        data-testid="channel-overflow-members-entry"
      >
        <SectionEyebrow
          tone="muted"
          role="heading"
          aria-level={3}
          data-testid="channel-overflow-members-heading"
        >
          {formatMessage({ id: "message.chatPanel.overflow.members" })}
        </SectionEyebrow>
        <span className="inline-flex min-w-0 items-center gap-1 text-caption text-foreground-hint">
          {loading
            ? formatMessage({ id: "message.chatPanel.overflow.membersLoading" })
            : channelExternalMembers.length > 0
              ? formatMessage(
                { id: "message.chatPanel.overflow.membersSummaryWithSlack" },
                {
                  humans: channelHumans.length,
                  agents: channelAgents.length,
                  slack: channelExternalMembers.length,
                },
              )
              : formatMessage(
                { id: "message.chatPanel.overflow.membersSummary" },
                { humans: channelHumans.length, agents: channelAgents.length },
              )}
          <ChevronRight size={16} aria-hidden="true" />
        </span>
      </button>
      <TooltipProvider delay={MEMBERS_STRIP_TOOLTIP_DELAY_MS}>
        <div
          ref={columnStore.attach}
          className="mt-2 flex flex-wrap content-start items-center gap-2"
          aria-busy={loading}
          data-testid="channel-overflow-members-grid"
          data-max-rows={STRIP_MAX_ROWS}
          data-column-count={columnCount}
        >
          {loading && Array.from({ length: 3 }, (_, index) => (
            <Skeleton
              key={index}
              variant="block"
              className="size-[35px] shrink-0"
              data-testid="channel-overflow-member-skeleton"
            />
          ))}
          {!loading && humans.map((human) => {
            const label = human.displayName ?? human.name;
            return (
              <MemberStripTooltip key={human.id} label={label}>
                <button
                  type="button"
                  onClick={onOpen}
                  aria-label={label}
                  data-kind="human"
                  className={STRIP_TILE_BUTTON_CLASS}
                >
                  <AvatarSlot
                    context="panel-header"
                    type="human"
                    humanAvatarUrl={human.avatarUrl}
                    gravatarHash={human.gravatarHash}
                  />
                </button>
              </MemberStripTooltip>
            );
          })}
          {!loading && agents.map((agent) => {
            const label = agent.displayName ?? agent.name;
            return (
              <MemberStripTooltip key={agent.id} label={label}>
                <button
                  type="button"
                  onClick={onOpen}
                  aria-label={label}
                  data-kind="agent"
                  className={STRIP_TILE_BUTTON_CLASS}
                >
                  <AvatarSlot
                    context="panel-header"
                    type="agent"
                    agentAvatarUrl={agent.avatarUrl}
                    presence={agent.presence}
                  />
                </button>
              </MemberStripTooltip>
            );
          })}
          {!loading && externalMembers.map((member) => {
            const label = formatMessage(
              { id: "message.chatPanel.overflow.slackMemberLabel" },
              { name: member.displayName },
            );
            return (
              <MemberStripTooltip key={member.id} label={label}>
                <button
                  type="button"
                  onClick={onOpen}
                  aria-label={label}
                  data-kind="external"
                  className={STRIP_TILE_BUTTON_CLASS}
                >
                  <AvatarSlot context="panel-header" type="human" humanAvatarUrl={member.avatarUrl} />
                </button>
              </MemberStripTooltip>
            );
          })}
          {!loading && overflow > 0 && (
            /* DS avatar stack overflow (`rf-avatars__more`): a sunken tile
               with the remaining count in machine type. */
            <button
              type="button"
              onClick={onOpen}
              className={`${STRIP_TILE_BUTTON_CLASS} flex h-[35px] min-w-[35px] items-center justify-center bg-fill-muted px-1 font-mono text-mono-meta font-bold text-foreground-muted hover:press-overlay`}
              data-testid="channel-overflow-members-more"
            >
              {overflowLabel}
            </button>
          )}
          {onAdd && (
            <Tooltip content={formatMessage({ id: "agent.channelMembers.addMember" })}>
              {/* DS empty identity (`rf-avatar--empty`): a dashed ink-3 square
                  with a plus — the place a new member would take. */}
              <button
                type="button"
                onClick={onAdd}
                disabled={loading}
                aria-label={formatMessage({ id: "agent.channelMembers.addMember" })}
                className={`${STRIP_TILE_BUTTON_CLASS} flex size-[35px] items-center justify-center border-[1.5px] border-dashed border-foreground-hint text-foreground-hint hover:bg-fill-pressed disabled:cursor-wait disabled:border-line-hairline disabled:text-foreground-disabled`}
                data-testid="channel-overflow-members-add-tile"
              >
                <Plus size={20} aria-hidden="true" />
              </button>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>
    </div>
  );
}
function MemberPageSection({
  kind,
  label,
  count,
  children,
}: {
  kind: "humans" | "agents" | "external";
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <SidebarSection
      defaultOpen
      data-testid={`member-page-section-${kind}-group`}
    >
      <SidebarSectionHeader className="w-full!">
        <SidebarSectionDisclosure
          data-testid={`member-page-section-${kind}-toggle`}
        >
          <SidebarSectionChevron />
          <span
            className="flex min-w-0 items-center"
            data-testid={`member-page-section-${kind}`}
          >
            <SidebarSectionTitle>{label}</SidebarSectionTitle>
            <SidebarSectionCount>{" · "}{count}</SidebarSectionCount>
          </span>
        </SidebarSectionDisclosure>
      </SidebarSectionHeader>
      <SidebarList data-testid={`member-page-section-${kind}-panel`}>
        {children}
      </SidebarList>
    </SidebarSection>
  );
}
function AddMemberCandidateBody({
  name,
  description,
  trailing,
}: {
  name: ReactNode;
  description?: string | null;
  trailing?: ReactNode;
}) {
  const normalizedDescription = description?.trim();

  return (
    <span className="min-w-0 flex-1 text-left">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-callout font-semibold">{name}</span>
        {trailing}
      </span>
      {normalizedDescription ? (
        <Tooltip content={normalizedDescription}>
          <span
            className="block truncate text-caption text-foreground-hint"
          >
            {normalizedDescription}
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}
const CANDIDATE_ROW_CLASS = "flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-foreground transition-colors [@media(max-height:600px)]:py-1";
function candidateToggleRowClass(failed: boolean): string {
  return `${CANDIDATE_ROW_CLASS} disabled:cursor-not-allowed disabled:text-foreground-disabled ${
    failed ? "bg-warning-soft enabled:hover:press-overlay" : "enabled:hover:bg-fill-pressed"
  }`;
}
type AgentActivity=string;
const MEMBER_ROW_CLASS = [
  "group relative flex min-h-16 items-center gap-3 px-4 py-2.5 transition-colors md:min-h-14",
  "hover:bg-fill-pressed [@media(max-height:600px)]:min-h-0 [@media(max-height:600px)]:py-1.5",
  "[[data-member-row]+&]:before:pointer-events-none [[data-member-row]+&]:before:absolute [[data-member-row]+&]:before:top-0 [[data-member-row]+&]:before:right-0 [[data-member-row]+&]:before:left-[63px] [[data-member-row]+&]:before:border-t [[data-member-row]+&]:before:border-line-hairline",
  "[li+li>&]:before:pointer-events-none [li+li>&]:before:absolute [li+li>&]:before:top-0 [li+li>&]:before:right-0 [li+li>&]:before:left-[63px] [li+li>&]:before:border-t [li+li>&]:before:border-line-hairline",
].join(" ");
const MEMBER_ROW_TITLE_CLASS = "truncate text-subhead font-semibold text-foreground";
const MEMBER_ROW_SUB_CLASS = "truncate text-caption text-foreground-hint";
export function ChannelMemberRow({
  type,
  name,
  secondary,
  agentId,
  agentAvatarUrl,
  agentFallbackActivity,
  presence,
  humanAvatarUrl,
  gravatarHash,
  onAvatarClick,
  onRowClick,
  trailing,
}: {
  type: "agent" | "human";
  name: ReactNode;
  secondary?: ReactNode;
  agentId?: string;
  agentAvatarUrl?: string | null;
  agentFallbackActivity?: AgentActivity;
  presence?: Presence;
  humanAvatarUrl?: string | null;
  gravatarHash?: string | null;
  onAvatarClick?: () => void;
  /** Whole-row click (member page: row → profile). Mutually exclusive
   *  with onAvatarClick — a button cannot nest inside a button, so the
   *  avatar renders inert when the row itself is the click target. */
  onRowClick?: () => void;
  trailing?: ReactNode;
}) {
  const avatar = (
    <AvatarSlot
      context="list-row"
      type={type}
      agentAvatarUrl={agentAvatarUrl}
      humanAvatarUrl={humanAvatarUrl}
      gravatarHash={gravatarHash}
      presence={presence}
    />
  );

  const text = (
    <div className="min-w-0 flex-1">
      <div className={MEMBER_ROW_TITLE_CLASS}>
        {name}
      </div>
      {secondary ? (
        <div className={MEMBER_ROW_SUB_CLASS}>
          {secondary}
        </div>
      ) : null}
    </div>
  );

  const body = (
    <>
      {text}
      {trailing}
    </>
  );

  if (onRowClick) {
    // The row body (avatar + name + sub-line) IS the profile button; the
    // trailing slot (role tag, remove button) renders as a sibling so
    // interactive controls never nest inside a button.
    return (
      <div className={MEMBER_ROW_CLASS} data-member-row="">
        <button
          type="button"
          onClick={onRowClick}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-control text-left outline-none focus-visible:shadow-focus"
        >
          <span className="relative shrink-0">{avatar}</span>
          {text}
        </button>
        {trailing}
      </div>
    );
  }

  return (
    <div className={MEMBER_ROW_CLASS} data-member-row="">
      {onAvatarClick ? (
        <button
          type="button"
          onClick={onAvatarClick}
          className="relative shrink-0 rounded-sticker outline-none focus-visible:shadow-focus"
        >
          {avatar}
        </button>
      ) : (
        <span className="relative shrink-0">{avatar}</span>
      )}
      {body}
    </div>
  );
}
export function ChannelMemberRemoveButton({
  label,
  onClick,
  revealOnRowHover = true,
  visibleLabel,
  icon,
}: {
  label: string;
  onClick: () => void;
  /** Desktop hover-reveal. Uses visibility (not display) so the button's
   *  space is always reserved — the trailing badge never shifts when the
   *  control appears (Artea 2026-08-05: reveal jitter). Mobile always
   *  shows it (no hover). */
  revealOnRowHover?: boolean;
  /** Member-management rows render icon-only with a suitable icon (Artea,
   *  2026-09-17); other compact lists keep the bare icon affordance. */
  visibleLabel?: string;
  icon?: ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        className={`${revealOnRowHover ? "flex md:invisible md:group-hover:visible md:group-focus-within:visible" : "flex"} ${visibleLabel ? "h-8 px-2.5 text-footnote font-bold" : "size-8"} shrink-0 items-center justify-center rounded-control text-foreground-muted outline-none transition-colors hover:bg-fill-pressed hover:text-foreground active:bg-fill-pressed focus-visible:shadow-focus`}
        aria-label={label}
      >
        {visibleLabel ?? icon ?? <X size={16} aria-hidden="true" />}
      </button>
    </Tooltip>
  );
}
export function ChannelMemberHoverActions({
  roleAction,
  removeAction,
}: {
  roleAction?: {
    label: string;
    ariaLabel?: string;
    onClick: () => void;
    disabled?: boolean;
  };
  removeAction?: {
    label: string;
    onClick: () => void;
  };
}) {
  const onRoleAction = roleAction?.onClick;
  const handleRoleActionClick = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    onRoleAction?.();
  }, [onRoleAction]);

  if (!roleAction && !removeAction) return null;

  return (
    <span className="flex items-center gap-2" data-testid="channel-member-hover-actions">
      {roleAction && (
        <Button
          type="button"
          onClick={handleRoleActionClick}
          disabled={roleAction.disabled}
          size="sm"
          variant="outline"
          className="whitespace-nowrap"
          data-testid="channel-member-role-action"
          aria-label={roleAction.ariaLabel}
        >
          {roleAction.label}
        </Button>
      )}
      {removeAction && (
        <ChannelMemberRemoveButton
          label={removeAction.label}
          onClick={removeAction.onClick}
          revealOnRowHover={false}
          icon={<UserMinus size={16} aria-hidden />}
        />
      )}
    </span>
  );
}
export function MemberPage({showAddSection,membersLoading,totalParticipants,handleBackOrReset,rosterQuery,handleRosterQueryChange,visibleHumans,visibleAgents,renderHumanRow,renderAgentRow,openAddSection,showAddEntry,children,error}:{showAddSection:boolean;membersLoading:boolean;totalParticipants:number;handleBackOrReset:()=>void;rosterQuery:string;handleRosterQueryChange:(e:ChangeEvent<HTMLInputElement>)=>void;visibleHumans:Member[];visibleAgents:Member[];renderHumanRow:(m:Member,page:boolean)=>ReactNode;renderAgentRow:(m:Member,page:boolean)=>ReactNode;openAddSection:()=>void;showAddEntry:boolean;children?:ReactNode;error?:string}){
 const {formatMessage}=useIntl();const roleError=error,roleChangeFailed=false,removeTarget=false,hasAvailable=true;const visibleExternalMembers:ChannelExternalMember[]=[];const renderExternalRow=()=>null;
 const pageHeader=(
    <PanelHeader>
      {/* In the add view the back button is the add flow's own ‹ back
          (resetAddFlow), keeping the add-member-back contract the modal
          and panel headers use; otherwise it returns to the drawer root. */}
      <PanelAction
        onClick={handleBackOrReset}
        aria-label={formatMessage({
          id: showAddSection ? "agent.channelMembers.backToMembers" : "channel.membersPage.back",
        })}
        data-testid={showAddSection ? "add-member-back" : "member-page-back"}
      >
        <ArrowLeft />
      </PanelAction>
      <h2 className="truncate text-headline">
        {showAddSection
          ? formatMessage({ id: "agent.channelMembers.addMember" })
          : formatMessage({ id: "message.chatPanel.overflow.members" })}
      </h2>
      {!showAddSection && !membersLoading && (
        <Badge
          appearance="outline"
          className="shrink-0"
          data-testid="member-page-count"
        >
          {totalParticipants}
        </Badge>
      )}
      {!showAddSection && membersLoading && (
        <Spinner
          size="sm"
          aria-label={formatMessage({ id: "message.chatPanel.overflow.membersLoading" })}
          data-testid="member-page-count-loading"
        />
      )}
      <div className="flex-1" />
    </PanelHeader>
  );
 const pageListView=(
    <>
      {(roleError || roleChangeFailed) && (
        <Banner
          intent="warning"
          className="m-3 shrink-0"
          data-testid="channel-member-role-error"
        >
          {roleError || formatMessage({ id: "agent.channelMembers.updateRoleFailed" })}
        </Banner>
      )}

      {/* Persistent search — filters both sections live. */}
      <div className="shrink-0 border-b border-line-hairline px-4 py-3">
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="text"
            value={rosterQuery}
            onChange={handleRosterQueryChange}
            disabled={membersLoading}
            placeholder={formatMessage({ id: "channel.membersPage.searchPlaceholder" })}
            data-testid="member-page-search"
          />
        </InputGroup>
      </div>

      {/* Humans first (design master member-page), then agents. Each category
          uses Raft UI's disclosure primitive, starts expanded, and keeps its
          live filtered count in the trigger.

          The RUI sidebar section header bleeds by `--sidebar-row-inset-x`
          (6px each side) to escape its sidebar gutter; this page has no such
          gutter, so that bleed grew the header to calc(100% + 12px) and made
          the column scroll sideways. Zeroing the inset drops the negative
          margins, and w-full! replaces the 100%+12px width with one that fits
          the container - the chevron, label and count keep their exact
          positions, and the scrollbar disappears at its cause, not hidden.

          TEMPORARY (Artea, 2026-09-17): this page borrows RUI's sidebar
          section family for its groups, and that reuse is what leaks sidebar
          geometry into member rows. Two removals are tracked:
          - rui #284 derives the bleed width from the same variable instead of
            the hard-coded 12px; once the pinned raft-ui carries it, drop
            w-full! and keep only the inset declaration;
          - a generic rui Collapsible (commissioned in #proj-rui) will replace
            this SidebarSection reuse entirely, at which point both the inset
            declaration and this bridge are removed. */}
      <div className="min-h-0 flex-1 overflow-y-auto [--sidebar-row-inset-x:0px]">
        {membersLoading && (
          <div
            className="flex min-h-32 items-center justify-center gap-2 px-3 py-4 text-callout text-foreground-hint"
            aria-live="polite"
            data-testid="member-page-loading"
          >
            <Spinner
              size="sm"
              aria-label={formatMessage({ id: "message.chatPanel.overflow.membersLoading" })}
            />
            {formatMessage({ id: "message.chatPanel.overflow.membersLoading" })}
          </div>
        )}

        {!membersLoading && visibleHumans.length > 0 && (
          <MemberPageSection
            kind="humans"
            label={formatMessage({ id: "agent.channelMembers.humans" })}
            count={visibleHumans.length}
          >
            {visibleHumans.map((human) => renderHumanRow(human, true))}
          </MemberPageSection>
        )}

        {!membersLoading && visibleAgents.length > 0 && (
          <MemberPageSection
            kind="agents"
            label={formatMessage({ id: "agent.channelMembers.agents" })}
            count={visibleAgents.length}
          >
            {visibleAgents.map((agent) => renderAgentRow(agent, true))}
          </MemberPageSection>
        )}

        {!membersLoading && visibleExternalMembers.length > 0 && (
          <MemberPageSection
            kind="external"
            label={formatMessage({ id: "agent.channelMembers.slackParticipants" })}
            count={visibleExternalMembers.length}
          >
            {visibleExternalMembers.map(renderExternalRow)}
          </MemberPageSection>
        )}

        {!membersLoading && totalParticipants === 0 && (
          <EmptyState
            icon={<Users size={36} aria-hidden="true" />}
            title={formatMessage({ id: "agent.channelMembers.noMembers" })}
          />
        )}
        {!membersLoading
          && totalParticipants > 0
          && visibleHumans.length === 0
          && visibleAgents.length === 0
          && visibleExternalMembers.length === 0 && (
          <EmptyState
            icon={<Search size={36} aria-hidden="true" />}
            title={formatMessage({ id: "agent.channelMembers.noMatches" }, { query: rosterQuery.trim() })}
          />
        )}
      </div>

      {/* ＋ Add members — bottom pinned; swaps in the staged multi-select
          add flow (drawer-internal third level, no Modal). Hidden while a
          remove confirm is staged so the bottom bar never stacks. */}
      {!removeTarget && showAddEntry && (
        <div className="shrink-0 border-t border-line-seam p-3">
          <Button
            size="lg"
            variant="outline"
            type="button"
            onClick={openAddSection}
            disabled={!hasAvailable}
            className="w-full"
            data-testid="member-page-add"
          >
            <Plus size={14} />
            {formatMessage({ id: "agent.channelMembers.addMember" })}
          </Button>

        </div>
      )}
    </>
  );
 return <div className="flex min-h-0 flex-1 flex-col bg-layer-canvas text-foreground" data-testid="member-page">{pageHeader}{showAddSection?<div className="flex min-h-0 flex-1 flex-col px-4 py-3">{children}</div>:pageListView}</div>;
}
export function MemberPicker({filteredAgents,memberSearch,handleMemberSearchChange,selectedKeys,toggleCandidate,adding,handleConfirmAddClick,onCreate,hasAvailable,error}:{filteredAgents:Member[];memberSearch:string;handleMemberSearchChange:(e:ChangeEvent<HTMLInputElement>)=>void;selectedKeys:Set<string>;toggleCandidate:(key:string)=>void;adding:boolean;handleConfirmAddClick:()=>void;onCreate:()=>void;hasAvailable:boolean;error?:string}){
 const {formatMessage}=useIntl();const failedKeys=new Set<string>(),filteredHumans:Member[]=[];
 const candidateKey=(_kind:string,id:string|undefined)=>id??"";
 const hasFilteredResults=filteredAgents.length>0,capabilities={createAgents:true},createEntryPromoted=false,createAgentPrefillName='',currentChannel=undefined as {name:string}|undefined;

 const candidateNameByKey=new Map(filteredAgents.map(a=>[a.id,a.displayName??a.name]));
 const addError:string|undefined=error,isPage=true;
 const addCandidateRows=(multiSelect: boolean, fillAvailableHeight = false) => (
    <Card
      // Column: the candidates scroll in the inner region; the create-agent
      // entry is a pinned footer OUTSIDE that region (task #99) so it is always
      // in view instead of only after scrolling to the end of a long list.
      className={`overflow-y-auto ${fillAvailableHeight ? "min-h-0 flex-1" : "max-h-72"}`}
      data-testid={multiSelect ? "add-member-candidate-list" : undefined}
    >
    <div className="min-h-0 flex-1 overflow-y-auto p-1" data-testid={multiSelect ? "add-member-candidate-scroll" : undefined}>
      {/* Available agents */}
      {filteredAgents.length > 0 && (
        <>
          <SectionEyebrow as="div" className="px-3 pb-1 pt-2">
            {formatMessage({ id: "agent.channelMembers.agents" })}
          </SectionEyebrow>
          {filteredAgents.map((agent) => {
            const key = candidateKey("agent", agent.id);
            
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => toggleCandidate(key)}
                disabled={adding}
                aria-pressed={selectedKeys.has(key)}
                aria-describedby={failedKeys.has(key) ? `add-member-failed-${key}` : undefined}
                className={candidateToggleRowClass(failedKeys.has(key))}
                data-testid={`add-candidate-agent-${agent.id}`}
              >
                <CheckboxIndicator checked={selectedKeys.has(key)} disabled={adding} />
                <AvatarSlot
                  context="compact-list"
                  type="agent"
                  agentAvatarUrl={agent.avatarUrl}
                  badge={<>{agent.badge}</>}
                  className="self-center"
                />
                <AddMemberCandidateBody
                  name={agent.displayName || agent.name}
                  description={agent.description}
                />
                {failedKeys.has(key) ? (
                  <span id={`add-member-failed-${key}`} className="sr-only">
                    {formatMessage({ id: "agent.channelMembers.addFailed" })}
                  </span>
                ) : null}
              </button>
            );
          })}
        </>
      )}

      {/* Available humans */}
      {filteredHumans.length > 0 && (
        <>
          <SectionEyebrow as="div" className="px-3 pb-1 pt-2">
            {formatMessage({ id: "agent.channelMembers.humans" })}
          </SectionEyebrow>
          {filteredHumans.map((human) => {
            const key = candidateKey("human", human.userId);
            
            return (
              <button
                key={human.userId}
                type="button"
                onClick={() => toggleCandidate(key)}
                disabled={adding}
                aria-pressed={selectedKeys.has(key)}
                aria-describedby={failedKeys.has(key) ? `add-member-failed-${key}` : undefined}
                className={candidateToggleRowClass(failedKeys.has(key))}
                data-testid={`add-candidate-human-${human.userId}`}
              >
                <CheckboxIndicator checked={selectedKeys.has(key)} disabled={adding} />
                <AvatarSlot
                  context="compact-list"
                  type="human"
                  humanAvatarUrl={human.avatarUrl}
                  gravatarHash={human.gravatarHash}
                  className="self-center"
                />
                <AddMemberCandidateBody
                  name={human.displayName || human.name}
                  description={human.description}
                />
                {failedKeys.has(key) ? (
                  <span id={`add-member-failed-${key}`} className="sr-only">
                    {formatMessage({ id: "agent.channelMembers.addFailed" })}
                  </span>
                ) : null}
              </button>
            );
          })}
        </>
      )}

      {!hasAvailable && (
        <div className="px-3 py-4 text-center text-callout text-foreground-hint">
          {formatMessage({ id: "agent.channelMembers.allMembersAdded" })}
        </div>
      )}

      {hasAvailable && !hasFilteredResults && (
        <div className="px-3 py-4 text-center text-callout text-foreground-hint">
          {formatMessage({ id: "agent.channelMembers.noMatches" }, { query: memberSearch.trim() })}
        </div>
      )}

    </div>
      {/* Create-a-new-Agent entry (task #584, design task #1139): persistent
          bottom row — pinned below the scrolling candidates (task #99), not the
          last scrolled row. When the search has no hit the
          typed text becomes the suggested name and the row steps up to the
          primary next action; without create permission the row stays VISIBLE
          but disabled with the reason — hiding it here would recreate the
          dead end this entry exists to remove. */}
      {multiSelect && (
        capabilities.createAgents ? (
          <button
            type="button"
            onClick={() => {
              
              onCreate();
            }}
            disabled={adding}
            data-testid="add-member-create-agent-entry"
            className={`flex w-full shrink-0 items-center gap-2.5 border-t border-line-seam px-4 py-2.5 text-left text-foreground transition-colors disabled:cursor-not-allowed disabled:text-foreground-disabled ${
              createEntryPromoted ? "bg-brand-soft enabled:hover:press-overlay" : "bg-layer-card enabled:hover:bg-fill-pressed"
            }`}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-sticker border-[1.5px] border-dashed border-foreground-hint text-foreground-hint">
              <Plus size={14} aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-callout font-semibold">
                {createEntryPromoted
                  ? formatMessage({ id: "channel.addMembers.createAgentNamed" }, { name: createAgentPrefillName })
                  : "创建角色"}
              </span>
              <span className="truncate text-caption text-foreground-hint">
                {"创建配置后，返回这里选择并添加实例"}
              </span>
            </span>
          </button>
        ) : (
          <div className="shrink-0 border-t border-line-seam px-4 py-2.5" data-testid="add-member-create-agent-entry-disabled">
            <div className="flex items-center gap-2.5 text-foreground-disabled">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-sticker border-[1.5px] border-dashed border-foreground-disabled">
                <Plus size={14} aria-hidden="true" />
              </span>
              <span className="text-callout font-semibold">{formatMessage({ id: "channel.addMembers.createAgent" })}</span>
            </div>
            <p className="mt-1.5 text-caption text-foreground-hint">
              {formatMessage({ id: "channel.addMembers.createAgentNoPermission" })}
            </p>
          </div>
        )
      )}
    </Card>
  );
 const addView=(
    <div
      className={isPage ? "flex min-h-0 flex-1 flex-col" : undefined}
      data-testid="add-member-view"
    >
      {addError && (
        <Banner intent="warning" className="mb-3" data-testid="add-member-error">
          {formatMessage({
            id: addError === "none"
              ? "channel.addMembers.noneAdded"
              : "agent.channelMembers.someAddFailed",
          })}
        </Banner>
      )}

      {/* D-state (task #584): created but not joined. Membership is the truth
          that clears this — however the join completes (banner retry, the
          staged「添加所选」, or a socket refresh), the banner goes away. */}
      

      {/* Selected chips — staged selection with per-chip deselect. */}
      {selectedKeys.size > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5" data-testid="add-member-selected-chips">
          {[...selectedKeys].map((key) => {
            const kind = key.startsWith("agent:") ? "agent" : "human";
            const failedNow = failedKeys.has(key);
            const memberName = candidateNameByKey.get(key) ?? key;
            return (
              <Badge
                key={key}
                appearance="soft"
                variant={failedNow ? "warning" : "default"}
                className="pr-0.5"
                data-member-kind={kind}
                data-member-status={failedNow ? "failed" : "selected"}
                data-testid={`add-member-selected-chip-${key}`}
              >
                <span className="max-w-32 truncate">{memberName}</span>
                {failedNow ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5" data-member-failure="true">
                    <AlertTriangle size={12} aria-hidden="true" />
                    <span>{formatMessage({ id: "agent.channelMembers.addFailed" })}</span>
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => toggleCandidate(key)}
                  disabled={adding}
                  className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-sticker text-foreground-hint transition-colors hover:bg-fill-pressed hover:text-foreground disabled:cursor-not-allowed disabled:text-foreground-disabled disabled:hover:bg-transparent"
                  aria-label={formatMessage({ id: "agent.channelMembers.deselectName" }, { name: memberName })}
                >
                  <X size={14} />
                </button>
              </Badge>
            );
          })}
        </div>
      )}

      {hasAvailable && (
        <FormField label={formatMessage({ id: "agent.channelMembers.search" })} className="mb-3">
          <InputGroup>
            <InputGroupAddon align="inline-start">
              <Search aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              type="text"
              value={memberSearch}
              onChange={handleMemberSearchChange}
              placeholder={formatMessage({ id: "agent.channelMembers.namePlaceholder" })}
              autoFocus
            />
          </InputGroup>
        </FormField>
      )}

      {addCandidateRows(true, isPage)}

      {/* Confirm — staged atomic commit; N=0 disabled; a rejected batch keeps
          every selected row available for correction/retry. */}
      <div className={`mt-4 ${isPage ? "shrink-0" : ""}`}>
        <Button size="lg"
          type="button"
          onClick={handleConfirmAddClick}
          disabled={adding || selectedKeys.size === 0}
          variant="primary"
          className="w-full"
          data-testid="add-member-confirm"
        >
          <Plus size={14} />
          {adding
            ? formatMessage({ id: "agent.channelMembers.adding" })
            : formatMessage({ id: "agent.channelMembers.confirmAdd" }, { count: selectedKeys.size })}
        </Button>
      </div>
    </div>
  );
 return addView;
}
