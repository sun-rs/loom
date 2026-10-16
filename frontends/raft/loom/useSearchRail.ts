// Structural port: MessageSearchPage selectableResults + stable identity + handleRailKeyDown.
// Scoped to the search rail; detail composers and native filter menus keep their handlers.
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { isSearchKeyboardComposing } from "../packages/web/src/components/search/searchComposition.ts";
export type SearchRailHandler =
  ((event: KeyboardEvent<HTMLElement>) => void) | null;
export function useSearchRail<T extends { id: string }>(
  rows: T[],
  enabled: boolean,
  handlerRef: RefObject<SearchRailHandler>,
  onOpen: (row: T, full: boolean) => void,
  initialId: string | null,
  epoch: string,
) {
  const [identity, setIdentity] = useState<string | null>(initialId);
  const [seenEpoch, setSeenEpoch] = useState(epoch);
  const indexHint = useRef(0);
  if (seenEpoch !== epoch) {
    setSeenEpoch(epoch);
    setIdentity(null);
    indexHint.current = 0;
  }
  const found = rows.findIndex((row) => row.id === identity);
  const index =
    found >= 0
      ? found
      : Math.min(indexHint.current, Math.max(0, rows.length - 1));
  const selectedId = rows[index]?.id ?? null;
  useEffect(() => {
    indexHint.current = index;
    if (rows.length) setIdentity(selectedId);
  }, [index, selectedId, rows.length]);
  useEffect(() => {
    if (initialId !== null) setIdentity(initialId);
  }, [initialId]);
  useEffect(() => {
    if (!enabled) return;
    handlerRef.current = (event) => {
      if (event.defaultPrevented || isSearchKeyboardComposing(event)) return;
      const target = event.target as HTMLElement;
      if (
        target.closest('[role="listbox"], [role="menu"]') ||
        (target.closest("button") &&
          !target.closest(
            "[data-search-rail-id], [data-result-id], [data-entity-id]",
          )) ||
        (target.matches("input") &&
          target.getAttribute("aria-label") !== "搜索内容")
      )
        return;
      if (!rows.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = Math.max(
          0,
          Math.min(
            index + (event.key === "ArrowDown" ? 1 : -1),
            rows.length - 1,
          ),
        );
        indexHint.current = next;
        setIdentity(rows[next]!.id);
        const rail = event.currentTarget,
          id = CSS.escape(rows[next]!.id);
        requestAnimationFrame(() =>
          rail
            .querySelector<HTMLElement>(
              `[data-search-rail-id="${id}"], [data-result-id="${id}"], [data-entity-id="${id}"]`,
            )
            ?.scrollIntoView({ block: "nearest" }),
        );
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        onOpen(rows[index]!, false);
      }
    };
    return () => {
      handlerRef.current = null;
    };
  }, [enabled, rows, index, handlerRef, onOpen]);
  return { selectedId, select: (row: T) => setIdentity(row.id) };
}
