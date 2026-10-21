import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const path =
  "frontends/raft/upstream/raft-web-source/packages/web/src/components/search/MessageSearchPage.tsx";
export function generateSearchSections() {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(
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
      throw Error("Expected unique official section, got " + matches.length);
    return matches[0].getText(file);
  }
  const section = (attribute) =>
    one(
      (n) =>
        ts.isJsxElement(n) &&
        n.openingElement.getText(file).includes(attribute),
    );
  const history = section('aria-labelledby="search-history-heading"');
  const recent = section('data-testid="search-overlay-recent"');
  const frequent = section('aria-labelledby="search-frequent-heading"');
  let groups = one(
    (n) =>
      ts.isJsxExpression(n) &&
      n.expression?.getText(file).startsWith("groupedMessageResults.map("),
  );
  // Stable group marker is the only presentation patch; keyboard messages retain their own result IDs.
  groups = groups.replace(
    "<SearchThreadResult\n",
    '<SearchThreadResult\n                              data-testid="search-thread-group"\n',
  );
  const footer = section(
    'className="flex flex-col items-center gap-2 px-4 py-4"',
  );
  const head = `// GENERATED from db5e399 MessageSearchPage JSX; original sections, explicit typed data/action slots.\nimport type {ReactNode} from "react";
import {useIntl} from "react-intl";
import {Badge,Button,SearchResultsSectionHeading,SearchResultsList,ThreadIcon,SearchThreadResult,SearchThreadResultHeader,SearchThreadResultMeta,SearchThreadResultTimestamp,SearchThreadResultTitle,SearchThreadResultMessages} from "raft-ui";
import {Clock3,Star,X} from "lucide-react";
import TextLink from "@loom/raft-web-source/TextLink";
import AppBanner from "../packages/web/src/components/ui/Banner";
import {shouldRenderSearchHistoryRemove} from "../packages/web/src/components/search/searchHome";
import {getSearchRelativeTimeParts,type SearchResultGroup,type SearchMessageResultLike} from "@loom/raft-web-source/searchGrouping";
import {formatRelativeTimeParts} from "../packages/web/src/utils/relativeTime";
`;
  return {
    "OfficialSearchSections.generated.tsx":
      head +
      `
export function SearchHistorySection({searchHistory,isTouchSearchHome,searchHistoryEditing,toggleSearchHistoryEdit,clearSearchHistory,chooseSearchHistoryEntry,forgetSearchQuery}:{searchHistory:string[];isTouchSearchHome:boolean;searchHistoryEditing:boolean;toggleSearchHistoryEdit:()=>void;clearSearchHistory:()=>void;chooseSearchHistoryEntry:(query:string)=>void;forgetSearchQuery:(query:string)=>void}) {const {formatMessage}=useIntl();return (${history});}
export function SearchRecentSection<T>({recentConversationEntities,renderEntityResultRow}:{recentConversationEntities:T[];renderEntityResultRow:(result:T,options:{returnHint:boolean})=>ReactNode}) {const {formatMessage}=useIntl();return (${recent});}
export function SearchFrequentSection<T>({frequentSearchEntities,renderSearchHomeEntity}:{frequentSearchEntities:T[];renderSearchHomeEntity:(result:T)=>ReactNode}) {const {formatMessage}=useIntl();return (${frequent});}
export function SearchGroupedMessages<T extends SearchMessageResultLike>({groupedMessageResults,renderMessageHit,getSourceLabel,selectedResultKey}:{groupedMessageResults:SearchResultGroup<T>[];renderMessageHit:(result:T,nested?:boolean)=>ReactNode;getSourceLabel:(result:T)=>string;selectedResultKey:string|null}) {const intl=useIntl(),{formatMessage}=intl;return (<>${groups}</>);}
export function SearchPaginationSection({loadingMore,loadMoreError,loadMoreResults,searchIncomplete=false,incompleteSearchNote}:{loadingMore:boolean;loadMoreError:boolean;loadMoreResults:()=>void;searchIncomplete?:boolean;incompleteSearchNote?:ReactNode}) {const {formatMessage}=useIntl();return (${footer});}
`,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  for (const [name, source] of Object.entries(generateSearchSections()))
    writeFileSync("frontends/raft/loom/" + name, source);
