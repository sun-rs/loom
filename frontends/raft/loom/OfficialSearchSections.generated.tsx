// GENERATED from db5e399 MessageSearchPage JSX; original sections, explicit typed data/action slots.
import type {ReactNode} from "react";
import {useIntl} from "react-intl";
import {Badge,Button,SearchResultsSectionHeading,SearchResultsList,ThreadIcon,SearchThreadResult,SearchThreadResultHeader,SearchThreadResultMeta,SearchThreadResultTimestamp,SearchThreadResultTitle,SearchThreadResultMessages} from "raft-ui";
import {Clock3,Star,X} from "lucide-react";
import TextLink from "@loom/raft-web-source/TextLink";
import AppBanner from "../packages/web/src/components/ui/Banner";
import {shouldRenderSearchHistoryRemove} from "../packages/web/src/components/search/searchHome";
import {getSearchRelativeTimeParts,type SearchResultGroup,type SearchMessageResultLike} from "@loom/raft-web-source/searchGrouping";
import {formatRelativeTimeParts} from "../packages/web/src/utils/relativeTime";

export function SearchHistorySection({searchHistory,isTouchSearchHome,searchHistoryEditing,toggleSearchHistoryEdit,clearSearchHistory,chooseSearchHistoryEntry,forgetSearchQuery}:{searchHistory:string[];isTouchSearchHome:boolean;searchHistoryEditing:boolean;toggleSearchHistoryEdit:()=>void;clearSearchHistory:()=>void;chooseSearchHistoryEntry:(query:string)=>void;forgetSearchQuery:(query:string)=>void}) {const {formatMessage}=useIntl();return (<section aria-labelledby="search-history-heading">
                <div className="flex items-center justify-between gap-3 pr-4">
                  <SearchResultsSectionHeading>
                    <Clock3 size={14} aria-hidden="true" />
                    <span id="search-history-heading">{formatMessage({ id: "search.history" })}</span>
                  </SearchResultsSectionHeading>
                  {/* Section actions are underlined ink text buttons (DS rf-section__action). */}
                  <div className="flex items-center gap-4 pt-5 pb-2">
                    {isTouchSearchHome ? (
                      <TextLink
                        variant="primary"
                        onClick={toggleSearchHistoryEdit}
                        className="text-footnote"
                        data-testid="search-history-edit-toggle"
                      >
                        {formatMessage({
                          id: searchHistoryEditing ? "search.doneEditHistory" : "search.editHistory",
                        })}
                      </TextLink>
                    ) : null}
                    <TextLink
                      variant="primary"
                      onClick={clearSearchHistory}
                      className="text-footnote"
                    >
                      {formatMessage({ id: "search.clearHistory" })}
                    </TextLink>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 px-4" data-testid="search-history-tags">
                  {searchHistory.map((historyQuery) => (
                    <Badge
                      key={historyQuery.toLocaleLowerCase()}
                      render={<div />}
                      appearance="soft"
                      className="group relative hover:press-overlay focus-within:shadow-focus"
                      data-testid="search-history-tag"
                    >
                      <button
                        type="button"
                        onClick={() => chooseSearchHistoryEntry(historyQuery)}
                        className="flex min-w-0 items-center gap-1 text-left outline-none after:absolute after:inset-0"
                      >
                        <Clock3 size={14} aria-hidden="true" />
                        <span className="truncate">{historyQuery}</span>
                      </button>
                      {shouldRenderSearchHistoryRemove({
                        isTouchViewport: isTouchSearchHome,
                        editing: searchHistoryEditing,
                      }) ? (
                        <button
                          type="button"
                          onClick={() => forgetSearchQuery(historyQuery)}
                          className={searchHistoryEditing
                            ? "relative z-10 -my-1 -mr-1 flex size-5.5 shrink-0 items-center justify-center rounded-sticker text-foreground-hint hover:bg-fill-pressed"
                            : "pointer-events-none relative z-10 -my-1 -mr-1 flex size-5.5 shrink-0 items-center justify-center rounded-sticker text-foreground-hint opacity-0 hover:bg-fill-pressed group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus:pointer-events-auto focus:opacity-100"}
                          aria-label={formatMessage({ id: "search.removeHistory" }, { query: historyQuery })}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      ) : null}
                    </Badge>
                  ))}
                </div>
              </section>);}
export function SearchRecentSection<T>({recentConversationEntities,renderEntityResultRow}:{recentConversationEntities:T[];renderEntityResultRow:(result:T,options:{returnHint:boolean})=>ReactNode}) {const {formatMessage}=useIntl();return (<div data-testid="search-overlay-recent">
              <SearchResultsSectionHeading>
                <Clock3 size={14} aria-hidden="true" />
                <span>{formatMessage({ id: "search.overlay.recentConversations" })}</span>
              </SearchResultsSectionHeading>
              <SearchResultsList>
                {recentConversationEntities.map((result) => renderEntityResultRow(result, { returnHint: true }))}
              </SearchResultsList>
            </div>);}
export function SearchFrequentSection<T>({frequentSearchEntities,renderSearchHomeEntity}:{frequentSearchEntities:T[];renderSearchHomeEntity:(result:T)=>ReactNode}) {const {formatMessage}=useIntl();return (<section aria-labelledby="search-frequent-heading">
              <SearchResultsSectionHeading>
                <Star size={14} aria-hidden="true" />
                <span id="search-frequent-heading">{formatMessage({ id: "search.frequent" })}</span>
              </SearchResultsSectionHeading>
              {frequentSearchEntities.length > 0 ? (
                <SearchResultsList>
                  {frequentSearchEntities.map(renderSearchHomeEntity)}
                </SearchResultsList>
              ) : (
                <p className="px-4 py-2 text-callout text-foreground-hint">
                  {formatMessage({ id: "search.frequentEmpty" })}
                </p>
              )}
            </section>);}
export function SearchGroupedMessages<T extends SearchMessageResultLike>({groupedMessageResults,renderMessageHit,getSourceLabel,selectedResultKey}:{groupedMessageResults:SearchResultGroup<T>[];renderMessageHit:(result:T,nested?:boolean)=>ReactNode;getSourceLabel:(result:T)=>string;selectedResultKey:string|null}) {const intl=useIntl(),{formatMessage}=intl;return (<>{groupedMessageResults.map((group) => {
                          if (group.kind === "message") {
                            return renderMessageHit(group.result);
                          }

                          const firstResult = group.results[0];
                          const sourceLabel = firstResult ? getSourceLabel(firstResult) : formatMessage({ id: "search.unknownSource" });
                          const groupHasSelected = group.results.some((r) => selectedResultKey === `message:${r.id}`);

                          return (
                            <SearchThreadResult
                              data-testid="search-thread-group"
                              key={group.key}
                              selected={groupHasSelected}
                            >
                              <SearchThreadResultHeader>
                                <div className="mb-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
                                  <Badge appearance="outline">
                                    <ThreadIcon width={12} height={12} />
                                    {formatMessage({ id: "search.threadBadge" })}
                                  </Badge>
                                  <SearchThreadResultMeta>{sourceLabel}</SearchThreadResultMeta>
                                  <span className="font-mono text-mono-meta text-foreground-hint">{formatMessage({ id: "search.hitsCount" }, { count: group.hitCount })}</span>
                                  <SearchThreadResultTimestamp>{(() => {
                                    const parts = getSearchRelativeTimeParts(group.latestCreatedAt);
                                    return parts ? formatRelativeTimeParts(parts.value, parts.unit, intl.locale) : formatMessage({ id: "search.grpUnknownTime" });
                                  })()}</SearchThreadResultTimestamp>
                                </div>
                                <SearchThreadResultTitle>{group.title || formatMessage({ id: "search.grpThreadDiscussion" })}</SearchThreadResultTitle>
                              </SearchThreadResultHeader>
                              <SearchThreadResultMessages>
                                {group.results.map((result) => renderMessageHit(result, true))}
                              </SearchThreadResultMessages>
                            </SearchThreadResult>
                          );
                        })}</>);}
export function SearchPaginationSection({loadingMore,loadMoreError,loadMoreResults,searchIncomplete=false,incompleteSearchNote}:{loadingMore:boolean;loadMoreError:boolean;loadMoreResults:()=>void;searchIncomplete?:boolean;incompleteSearchNote?:ReactNode}) {const {formatMessage}=useIntl();return (<div className="flex flex-col items-center gap-2 px-4 py-4">
                    {searchIncomplete && !loadMoreError && (
                      <p className="text-center text-caption text-foreground-hint">{incompleteSearchNote}</p>
                    )}
                    {loadMoreError ? (
                      <AppBanner
                        intent="warning"
                        role="alert"
                        withIcon
                        className="w-full"
                        actions={(
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={loadMoreResults}
                            disabled={loadingMore}
                          >
                            {loadingMore ? formatMessage({ id: "common.loading" }) : formatMessage({ id: "search.retry" })}
                          </Button>
                        )}
                      >
                        {formatMessage({ id: "search.loadMoreFailed" })}
                      </AppBanner>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={loadMoreResults}
                        disabled={loadingMore}
                      >
                        {loadingMore
                          ? formatMessage({ id: "common.loading" })
                          : formatMessage({ id: searchIncomplete ? "search.continueSearching" : "search.loadMore" })}
                      </Button>
                    )}
                  </div>);}
