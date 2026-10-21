import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDeclarations } from "./generate-appearance.mjs";
const path =
  "frontends/raft/upstream/raft-web-source/packages/web/src/components/search/MessageSearchPage.tsx";
export function generateSearchControls() {
  const source = readFileSync(path, "utf8"),
    file = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
  function one(predicate) {
    const matches = [];
    function walk(n) {
      if (predicate(n)) matches.push(n);
      ts.forEachChild(n, walk);
    }
    walk(file);
    if (matches.length !== 1)
      throw Error("Expected unique source boundary: " + matches.length);
    return matches[0];
  }
  function replace(s, from, to) {
    if (s.split(from).length !== 2)
      throw Error("Source boundary changed: " + from);
    return s.replace(from, to);
  }
  const variable = (name) => {
    let n = one(
      (n) => ts.isVariableDeclaration(n) && n.name.getText(file) === name,
    ).initializer;
    while (ts.isParenthesizedExpression(n)) n = n.expression;
    return n.getText(file);
  };
  const sender = one(
    (n) =>
      ts.isJsxElement(n) &&
      n.openingElement.tagName.getText(file) === "Combobox" &&
      n.openingElement.getText(file).includes("senderFilterQuery"),
  ).getText(file);
  const channel = one(
    (n) =>
      ts.isJsxExpression(n) &&
      n.expression?.getText(file).startsWith("channelIdParam ? (() =>"),
  ).getText(file);
  let filters = one(
    (n) =>
      ts.isJsxElement(n) &&
      n.openingElement.tagName.getText(file) === "SearchShellFilters",
  ).getText(file);
  filters = replace(filters, sender, "{senderSlot}");
  filters = replace(filters, channel, "{channelSlot}");
  filters = replace(
    filters,
    "<SearchShellFilters ref=",
    "<SearchShellFilters onKeyDown={handleFilterKeyDown} ref=",
  );
  filters = replace(
    filters,
    "</SearchShellFilters>",
    "{directoryError}</SearchShellFilters>",
  );
  const identity = replace(
    sender,
    "<Combobox<string>",
    "<Combobox<string> disabled={disabled}",
  );
  const channelIdentity = replace(
    channel.slice(1, -1),
    "<Combobox<string>",
    "<Combobox<string> disabled={disabled}",
  );
  let field = variable("searchFieldInner");
  field = replace(
    field,
    "aria-label={searchPlaceholder}",
    'aria-label="搜索内容"\n        maxLength={300}\n        autoFocus={overlayChrome}\n        onKeyDown={handleKeyDown}',
  );
  const header = one(
    (n) =>
      ts.isJsxExpression(n) &&
      n.expression?.getText(file).startsWith("overlayChrome ? (") &&
      n.getText(file).includes("{searchFieldInner}"),
  ).getText(file);
  const empty = variable("centeredEmptyState");
  let noResults = one(
    (n) =>
      ts.isJsxSelfClosingElement(n) &&
      n.tagName.getText(file) === "AppEmptyState" &&
      n.getText(file).includes("search.noResultsForQuery"),
  ).getText(file);
  noResults = replace(
    noResults,
    ': query.trim() ? formatMessage({ id: "search.noResultsForQuery" }',
    ': !hasEntityResults && query.trim() ? formatMessage({ id: "search.noResultsForQuery" }',
  );
  const helpers = extractDeclarations(source, [
    "SEARCH_SCOPE_OPTIONS",
    "SEARCH_TIME_RANGES",
    "SEARCH_SORTS",
    "getScopeOptionLabelId",
    "getScopeChipLabel",
    "getTimeRangeLabelId",
  ]).join("\n");
  const imports = `// GENERATED from locked db5e399 MessageSearchPage; source JSX with explicit Loom compatibility slots.\nimport type {ReactNode} from "react";
import {useIntl,type IntlShape} from "react-intl";
import {Search,X,AtSign,CalendarRange,ArrowDownUp,ChevronDown,UserCircle2,Hash} from "lucide-react";
import {Skeleton,Button,InputGroup,InputGroupInput,InputGroupAddon,Kbd,SearchShellFilters,PickerTriggerButton,Select,SelectTrigger,SelectIcon,SelectContent,SelectList,SelectGroup,SelectGroupLabel,SelectSeparator,SelectItem,SelectItemText,SelectItemIndicator,Combobox,ComboboxClear,ComboboxContent,ComboboxEmpty,ComboboxHeader,ComboboxInput,ComboboxInputGroup,ComboboxItem,ComboboxItemIndicator,ComboboxLabel,ComboboxList,ComboboxSeparator,ComboboxTrigger,ComboboxTriggerIndicator} from "raft-ui";
import type {SearchScope,SearchSort,SearchTimeRange} from "@loom/raft-web-source/searchGrouping";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot";
import AppEmptyState from "@loom/raft-web-source/EmptyState";
`;
  return {
    "OfficialSearchControls.generated.tsx":
      imports +
      helpers +
      `
${extractDeclarations(source, ["SearchSkeleton"]).join("\n")}
export function SearchLoading(){return <div role="status" aria-label="正在读取结果"><SearchSkeleton/></div>;}
const appliedFilterProps=(applied:boolean)=>(applied ? {"data-has-value":""}:{});
export function OfficialSearchHeader({inputRef,query,overlayChrome,handleBack,mobileBackProps,searchPlaceholder,handleQueryChange,handleQueryCompositionStart,handleQueryCompositionEnd,handleKeyDown,clearQuery}:ReturnType<typeof import("./SearchHeader").useSearchHeaderController>) {const {formatMessage}=useIntl(); const searchFieldInner=(${field});return (<>${header}</>);}
export function OfficialSearchFilters({query,overlayChrome,filtersPortalRef,filtersPortalProps,openFilterMenu,scopes,scopeValue,sort,timeRange,scopeItems,timeRangeItems,sortItems,handleScopeMenuOpenChange,handleTimeMenuOpenChange,handleSortMenuOpenChange,setScopeFilters,handleTimeRangeChange,handleSortChange,hasActiveFilters,clearAllFilters,handleFilterKeyDown,senderSlot,channelSlot,directoryError}:ReturnType<typeof import("./SearchFilters").useSearchFilterController>) {const {formatMessage}=useIntl();return (${filters});}
export function OfficialSearchIdentityFilter({kind,disabled,filtersPortalProps,openFilterMenu,senderFilterQuery,senderItemIds,senderItemLabel,senderIdParam,handleFromMenuOpenChange,handleSenderInputChange,handleSenderChange,clearSenderFilter,selectedSender,filteredSenderOptions,channelIdParam,channels,dmChannels,clearChannelFilter,channelFilterQuery,channelItemIds,channelItemLabel,handleChannelMenuOpenChange,handleChannelInputChange,handleChannelChange,filteredChannels}:ReturnType<typeof import("./SearchIdentityFilter").useSearchIdentityController>){const {formatMessage}=useIntl();return kind==="from"?(${identity}):(${channelIdentity});}
export function SearchHomeEmpty(){const {formatMessage}=useIntl();return (${empty});}
export function SearchNoResults({query,hasEntityResults=false}:{query:string;hasEntityResults?:boolean}){const {formatMessage}=useIntl(); const searchIncomplete=false,incompleteSearchNote=undefined,loadingMore=false,loadMoreResults=()=>{};return (${noResults});}
`,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  for (const [name, source] of Object.entries(generateSearchControls()))
    writeFileSync("frontends/raft/loom/" + name, source);
