// GENERATED from immutable Raft db5e399 threadSearch declarations; do not edit.
import type {Root} from "mdast";
import {messageTokenNode,replaceTokensInTree,SKIP_CODE_AND_TOKENS} from "@loom/raft-web-source/remarkMessageTokens";
export function normalizeThreadSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}
export function highlightThreadSearchInTree(tree: Root, query: string): void {
  const normalizedQuery = normalizeThreadSearchQuery(query);
  if (!normalizedQuery) return;
  const pattern = new RegExp(normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  replaceTokensInTree(
    tree,
    [{ pattern, replace: (match) => messageTokenNode("mark", match[0]) }],
    undefined,
    SKIP_CODE_AND_TOKENS,
  );
}
