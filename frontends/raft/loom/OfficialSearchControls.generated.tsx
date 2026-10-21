// GENERATED from locked db5e399 MessageSearchPage; source JSX with explicit Loom compatibility slots.
import type {ReactNode} from "react";
import {useIntl,type IntlShape} from "react-intl";
import {Search,X,AtSign,CalendarRange,ArrowDownUp,ChevronDown,UserCircle2,Hash} from "lucide-react";
import {Skeleton,Button,InputGroup,InputGroupInput,InputGroupAddon,Kbd,SearchShellFilters,PickerTriggerButton,Select,SelectTrigger,SelectIcon,SelectContent,SelectList,SelectGroup,SelectGroupLabel,SelectSeparator,SelectItem,SelectItemText,SelectItemIndicator,Combobox,ComboboxClear,ComboboxContent,ComboboxEmpty,ComboboxHeader,ComboboxInput,ComboboxInputGroup,ComboboxItem,ComboboxItemIndicator,ComboboxLabel,ComboboxList,ComboboxSeparator,ComboboxTrigger,ComboboxTriggerIndicator} from "raft-ui";
import type {SearchScope,SearchSort,SearchTimeRange} from "@loom/raft-web-source/searchGrouping";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot";
import AppEmptyState from "@loom/raft-web-source/EmptyState";
const SEARCH_SCOPE_OPTIONS = ["mentioned", "humans", "agents"] as const satisfies readonly SearchScope[];
const SEARCH_TIME_RANGES = ["any", "today", "7d", "30d"] as const satisfies readonly SearchTimeRange[];
const SEARCH_SORTS = ["relevance", "recent"] as const satisfies readonly SearchSort[];
function getScopeOptionLabelId(scope: SearchScope): "search.scopeMe" | "search.scopeHumans" | "search.scopeAgents" {
  switch (scope) {
    case "mentioned":
      return "search.scopeMe";
    case "humans":
      return "search.scopeHumans";
    case "agents":
      return "search.scopeAgents";
  }
}
function getScopeChipLabel(scopes: readonly SearchScope[], formatMessage: IntlShape["formatMessage"]): ReactNode {
  return scopes.length > 0
    ? formatMessage(
        { id: "search.scopeChip" },
        { count: <span key="count" className="font-mono text-mono-meta font-bold">{scopes.length}</span> },
      )
    : formatMessage({ id: "search.scope" });
}
function getTimeRangeLabelId(range: SearchTimeRange): "search.timeToday" | "search.timeLast7" | "search.timeLast30" | "search.timeAny" {
  switch (range) {
    case "today":
      return "search.timeToday";
    case "7d":
      return "search.timeLast7";
    case "30d":
      return "search.timeLast30";
    default:
      return "search.timeAny";
  }
}
function SearchSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="grid grid-cols-[27px_minmax(0,1fr)] gap-x-3 px-4 py-3">
          <Skeleton variant="block" className="row-span-2 size-[27px]" />
          <div className="mb-2 flex gap-2">
            <Skeleton variant="line" className="h-3 w-24" />
            <Skeleton variant="line" className="h-3 w-20" />
            <Skeleton variant="line" className="ml-auto h-3 w-12" />
          </div>
          <div className="space-y-2">
            <Skeleton variant="line" className="h-3 w-full" />
            <Skeleton variant="line" className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
export function SearchLoading(){return <div role="status" aria-label="正在读取结果"><SearchSkeleton/></div>;}
const appliedFilterProps=(applied:boolean)=>(applied ? {"data-has-value":""}:{});
export function OfficialSearchHeader({inputRef,query,overlayChrome,handleBack,mobileBackProps,searchPlaceholder,handleQueryChange,handleQueryCompositionStart,handleQueryCompositionEnd,handleKeyDown,clearQuery}:ReturnType<typeof import("./SearchHeader").useSearchHeaderController>) {const {formatMessage}=useIntl(); const searchFieldInner=(<InputGroup className="min-w-0 flex-1">
      <InputGroupAddon align="inline-start">
        <Search aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        value={query}
        onChange={handleQueryChange}
        onCompositionStart={handleQueryCompositionStart}
        onCompositionEnd={handleQueryCompositionEnd}
        placeholder={searchPlaceholder}
        aria-label="搜索内容"
        maxLength={300}
        autoFocus={overlayChrome}
        onKeyDown={handleKeyDown}
        data-testid="message-search-input"
      />
      <InputGroupAddon align="inline-end">
        {query ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={clearQuery}
            aria-label={formatMessage({ id: "search.clearSearch" })}
          >
            <X aria-hidden size={18} />
          </Button>
        ) : null}
        <Kbd className="hidden sm:inline-flex">
          Esc
        </Kbd>
      </InputGroupAddon>
    </InputGroup>);return (<>{overlayChrome ? (
        /* Slim command-palette header (desktop ⌘K overlay): the input IS the top
           bar with the search icon inline — no PanelHeader, mobile-back, or icon
           badge. */
        <div className="flex shrink-0 items-center border-b border-line-seam px-3 py-3">
          {searchFieldInner}
        </div>
      ) : (
        <PanelHeader
          onMobileBack={handleBack}
          mobileBackProps={mobileBackProps}
          titleSlot={
            /* The field carries the search glyph itself (DS Search), so the
               header needs no separate icon tile at any viewport. */
            <div className="flex min-w-0 flex-1 items-center">
              {searchFieldInner}
            </div>
          }
        />
      )}</>);}
export function OfficialSearchFilters({query,overlayChrome,filtersPortalRef,filtersPortalProps,openFilterMenu,scopes,scopeValue,sort,timeRange,scopeItems,timeRangeItems,sortItems,handleScopeMenuOpenChange,handleTimeMenuOpenChange,handleSortMenuOpenChange,setScopeFilters,handleTimeRangeChange,handleSortChange,hasActiveFilters,clearAllFilters,handleFilterKeyDown,senderSlot,channelSlot,directoryError}:ReturnType<typeof import("./SearchFilters").useSearchFilterController>) {const {formatMessage}=useIntl();return (<SearchShellFilters onKeyDown={handleFilterKeyDown} ref={filtersPortalRef} className={overlayChrome ? "px-3" : undefined}>
        <div className="flex flex-wrap items-center gap-2">
          {senderSlot}

          <Select<SearchScope, true>
            multiple
            open={openFilterMenu === "scope"}
            onOpenChange={handleScopeMenuOpenChange}
            items={scopeItems}
            value={scopeValue}
            onValueChange={setScopeFilters}
          >
            <SelectTrigger
              aria-label={formatMessage({ id: "search.scope" })}
              render={<PickerTriggerButton {...appliedFilterProps(scopes.length > 0)} />}
            >
              <AtSign aria-hidden size={14} />
              <span>{getScopeChipLabel(scopes, formatMessage)}</span>
              <SelectIcon>
                <ChevronDown aria-hidden size={12} />
              </SelectIcon>
            </SelectTrigger>
            <SelectContent align="start" portalProps={filtersPortalProps}>
              <SelectList>
                <SelectGroup>
                  <SelectGroupLabel>{formatMessage({ id: "search.scope" })}</SelectGroupLabel>
                  <SelectSeparator />
                  {SEARCH_SCOPE_OPTIONS.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      <SelectItemText>{formatMessage({ id: getScopeOptionLabelId(mode) })}</SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectList>
            </SelectContent>
          </Select>

          {channelSlot}

          <Select<SearchTimeRange>
            open={openFilterMenu === "time"}
            onOpenChange={handleTimeMenuOpenChange}
            items={timeRangeItems}
            value={timeRange}
            onValueChange={handleTimeRangeChange}
          >
            <SelectTrigger
              aria-label={formatMessage({ id: "search.time" })}
              render={<PickerTriggerButton {...appliedFilterProps(timeRange !== "any")} />}
            >
              <CalendarRange aria-hidden size={14} />
              <span>{formatMessage({ id: getTimeRangeLabelId(timeRange) })}</span>
              <SelectIcon>
                <ChevronDown aria-hidden size={12} />
              </SelectIcon>
            </SelectTrigger>
            <SelectContent align="start" portalProps={filtersPortalProps}>
              <SelectList>
                <SelectGroup>
                  <SelectGroupLabel>{formatMessage({ id: "search.time" })}</SelectGroupLabel>
                  <SelectSeparator />
                  {SEARCH_TIME_RANGES.map((range) => (
                    <SelectItem key={range} value={range}>
                      <SelectItemText>{formatMessage({ id: getTimeRangeLabelId(range) })}</SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectList>
            </SelectContent>
          </Select>

          {/* Sort chip — same shape as From / Channel / Time per stdrc
              #proj-uiux:c2313b1d msg=da1194bd (2026-05-26): replaces the
              prior Relevant/Recent segmented toggle with a Sort dropdown
              positioned after the existing filter chips. Chip reads as
              applied (cyan-soft) when sort != default (relevance), matching
              the time-chip pattern (applied when timeRange != "any"). Conceptually
              sort isn't a filter, so it's NOT included in `hasActiveFilters`
              and `clearAllFilters` does NOT reset it — only the visual
              treatment matches. */}
          <Select<SearchSort>
            disabled={!query.trim()}
            open={openFilterMenu === "sort"}
            onOpenChange={handleSortMenuOpenChange}
            items={sortItems}
            value={sort}
            onValueChange={handleSortChange}
          >
            <SelectTrigger
              aria-label={formatMessage({ id: "search.sort" })}
              data-testid="search-sort-chip"
              render={<PickerTriggerButton {...appliedFilterProps(sort !== "relevance")} />}
            >
              <ArrowDownUp aria-hidden size={14} />
              <span>{sort === "recent" ? formatMessage({ id: "search.sortRecent" }) : formatMessage({ id: "search.sortRelevant" })}</span>
              <SelectIcon>
                <ChevronDown aria-hidden size={12} />
              </SelectIcon>
            </SelectTrigger>
            <SelectContent align="start" portalProps={filtersPortalProps}>
              <SelectList>
                <SelectGroup>
                  <SelectGroupLabel>{formatMessage({ id: "search.sort" })}</SelectGroupLabel>
                  <SelectSeparator />
                  {SEARCH_SORTS.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      <SelectItemText>{mode === "relevance" ? formatMessage({ id: "search.sortRelevant" }) : formatMessage({ id: "search.sortRecent" })}</SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectList>
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
            >
              {formatMessage({ id: "search.clearAll" })}
            </Button>
          )}
        </div>
      {directoryError}</SearchShellFilters>);}
export function OfficialSearchIdentityFilter({kind,disabled,filtersPortalProps,openFilterMenu,senderFilterQuery,senderItemIds,senderItemLabel,senderIdParam,handleFromMenuOpenChange,handleSenderInputChange,handleSenderChange,clearSenderFilter,selectedSender,filteredSenderOptions,channelIdParam,channels,dmChannels,clearChannelFilter,channelFilterQuery,channelItemIds,channelItemLabel,handleChannelMenuOpenChange,handleChannelInputChange,handleChannelChange,filteredChannels}:ReturnType<typeof import("./SearchIdentityFilter").useSearchIdentityController>){const {formatMessage}=useIntl();return kind==="from"?(<Combobox<string> disabled={disabled}
            autoHighlight
            open={openFilterMenu === "from"}
            onOpenChange={handleFromMenuOpenChange}
            inputValue={senderFilterQuery}
            items={senderItemIds}
            itemToStringLabel={senderItemLabel}
            value={senderIdParam || null}
            onInputValueChange={handleSenderInputChange}
            onValueChange={handleSenderChange}
          >
            <ComboboxTrigger
              aria-label={formatMessage({ id: "search.from" })}
              render={<PickerTriggerButton {...appliedFilterProps(Boolean(senderIdParam))} />}
            >
              <UserCircle2 aria-hidden size={14} />
              <span>
                {selectedSender
                  ? formatMessage(
                      { id: "search.fromWithName" },
                      { name: selectedSender.isSelf ? formatMessage({ id: "search.fromMe" }) : selectedSender.label },
                    )
                  : formatMessage({ id: "search.from" })}
              </span>
              <ComboboxTriggerIndicator>
                <ChevronDown aria-hidden size={12} />
              </ComboboxTriggerIndicator>
            </ComboboxTrigger>
            <ComboboxContent
              align="start"
              finalFocus={false}
              initialFocus={false}
              portalProps={filtersPortalProps}
            >
              <ComboboxHeader>
                <ComboboxLabel>{formatMessage({ id: "search.from" })}</ComboboxLabel>
                {senderIdParam && (
                  <ComboboxClear onClick={clearSenderFilter}>
                    {formatMessage({ id: "ui.selectionPopover.clear" })}
                  </ComboboxClear>
                )}
              </ComboboxHeader>
              <ComboboxSeparator />
              <ComboboxInputGroup>
                <ComboboxInput
                  aria-label={formatMessage({ id: "search.from" })}
                  placeholder={formatMessage({ id: "ui.selectionPopover.searchPlaceholder" })}
                  suppressPasswordManager
                />
              </ComboboxInputGroup>
              <ComboboxList>
                {filteredSenderOptions.map((sender) => (
                  <ComboboxItem key={sender.id} value={sender.id}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex size-5 shrink-0 items-center justify-center">
                        <AvatarSlot
                          context="compact-list"
                          type={sender.type === "agent" ? "agent" : "human"}
                          agentAvatarUrl={sender.type === "agent" ? sender.avatarUrl ?? null : null}
                          humanAvatarUrl={sender.type === "user" ? sender.avatarUrl ?? null : null}
                          gravatarHash={sender.type === "user" ? sender.gravatarHash ?? null : null}
                          email={sender.type === "user" ? sender.email ?? null : null}
                        />
                      </span>
                      <span className="truncate">{sender.isSelf ? formatMessage({ id: "search.fromMe" }) : sender.label}</span>
                    </span>
                    <ComboboxItemIndicator />
                  </ComboboxItem>
                ))}
              </ComboboxList>
              <ComboboxEmpty>{formatMessage({ id: "ui.selectionPopover.emptyLabel" })}</ComboboxEmpty>
            </ComboboxContent>
          </Combobox>):(channelIdParam ? (() => {
            const ch = channels.find((c) => c.id === channelIdParam) ?? dmChannels.find((c) => c.id === channelIdParam);
            const label = ch ? `#${ch.name}` : `#${formatMessage({ id: "search.channel" })}`;
            return (
              <PickerTriggerButton
                type="button"
                data-has-value=""
                onClick={clearChannelFilter}
              >
                <Hash aria-hidden size={14} />
                <span>{label}</span>
                <X aria-hidden size={14} />
              </PickerTriggerButton>
            );
          })() : (
            <Combobox<string> disabled={disabled}
              autoHighlight
              open={openFilterMenu === "channel"}
              onOpenChange={handleChannelMenuOpenChange}
              inputValue={channelFilterQuery}
              items={channelItemIds}
              itemToStringLabel={channelItemLabel}
              value={null}
              onInputValueChange={handleChannelInputChange}
              onValueChange={handleChannelChange}
            >
              <ComboboxTrigger
                aria-label={formatMessage({ id: "search.openChannelFilter" })}
                render={<PickerTriggerButton />}
              >
                <Hash aria-hidden size={14} />
                <span>{formatMessage({ id: "search.channel" })}</span>
                <ComboboxTriggerIndicator>
                  <ChevronDown aria-hidden size={12} />
                </ComboboxTriggerIndicator>
              </ComboboxTrigger>
              <ComboboxContent
                align="start"
                finalFocus={false}
                initialFocus={false}
                portalProps={filtersPortalProps}
              >
                <ComboboxHeader>
                  <ComboboxLabel>{formatMessage({ id: "search.channels" })}</ComboboxLabel>
                </ComboboxHeader>
                <ComboboxSeparator />
                <ComboboxInputGroup>
                  <ComboboxInput
                    aria-label={formatMessage({ id: "search.channels" })}
                    placeholder={formatMessage({ id: "ui.selectionPopover.searchPlaceholder" })}
                    suppressPasswordManager
                  />
                </ComboboxInputGroup>
                <ComboboxList>
                  {filteredChannels.map((ch) => (
                    <ComboboxItem key={ch.id} value={ch.id}>
                      <span className="flex size-5 shrink-0 items-center justify-center">
                        <Hash aria-hidden size={12} />
                      </span>
                      <span>#{ch.name}</span>
                      <ComboboxItemIndicator />
                    </ComboboxItem>
                  ))}
                </ComboboxList>
                <ComboboxEmpty>{formatMessage({ id: "ui.selectionPopover.emptyLabel" })}</ComboboxEmpty>
              </ComboboxContent>
            </Combobox>
          ));}
export function SearchHomeEmpty(){const {formatMessage}=useIntl();return (<AppEmptyState
      className="h-full justify-center"
      data-testid="search-home"
      icon={<Search size={36} aria-hidden="true" />}
      title={formatMessage({ id: "search.emptyTitle" })}
      description={formatMessage({ id: "search.emptyBody" })}
    />);}
export function SearchNoResults({query,hasEntityResults=false}:{query:string;hasEntityResults?:boolean}){const {formatMessage}=useIntl(); const searchIncomplete=false,incompleteSearchNote=undefined,loadingMore=false,loadMoreResults=()=>{};return (<AppEmptyState
                className="py-16"
                icon={<Search size={36} aria-hidden="true" />}
                title={searchIncomplete
                  ? formatMessage({ id: "search.incompleteNoMatchesYet" })
                  : !hasEntityResults && query.trim() ? formatMessage({ id: "search.noResultsForQuery" }, { query: query.trim() }) : formatMessage({ id: "search.noMatchingMessages" })}
                description={searchIncomplete
                  ? incompleteSearchNote
                  : query.trim() ? formatMessage({ id: "search.tryDifferentKeywords" }) : formatMessage({ id: "search.tryDifferentFilters" })}
                action={searchIncomplete ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={loadMoreResults}
                    disabled={loadingMore}
                  >
                    {loadingMore ? formatMessage({ id: "common.loading" }) : formatMessage({ id: "search.continueSearching" })}
                  </Button>
                ) : undefined}
              />);}
