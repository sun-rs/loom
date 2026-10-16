// Structural port: MessageSearchPage selectableResults identity + handleRailKeyDown.
// The host installs this only on the search rail, never on document or the detail pane.
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { isSearchKeyboardComposing } from "../packages/web/src/components/search/searchComposition.ts";
import type { DiscoveryRow } from "./discovery-client.ts";
export type SearchRailHandler =
  ((event: KeyboardEvent<HTMLElement>) => void) | null;
export function useSearchRail(
  rows: DiscoveryRow[],
  enabled: boolean,
  handlerRef: RefObject<SearchRailHandler>,
  onOpen: (row: DiscoveryRow, full: boolean) => void,
  initialId: string | null,
  home?: () => void,
) {
  const [atHome, setAtHome] = useState(Boolean(home));
  const [identity, setIdentity] = useState<string | null>(initialId);
  const indexHint = useRef(0);
  const identityIndex = rows.findIndex((row) => row.id === identity);
  const index =
    identityIndex >= 0
      ? identityIndex
      : Math.min(indexHint.current, Math.max(0, rows.length - 1));
  const selectedId = rows[index]?.id ?? null;
  useEffect(() => {
    indexHint.current = index;
    if (rows.length) setIdentity(selectedId);
  }, [index, selectedId, rows.length]);
  useEffect(() => {
    if (!enabled) return;
    handlerRef.current = (event) => {
      if (event.defaultPrevented || isSearchKeyboardComposing(event)) return;
      const target = event.target as HTMLElement;
      // Base UI popovers and non-result buttons keep their own native keyboard behavior.
      if (
        target.closest('[role="listbox"], [role="menu"]') ||
        (target.closest("button") && !target.closest("[data-result-id]")) ||
        (target.matches("input") &&
          target.getAttribute("aria-label") !== "搜索内容")
      )
        return;
      if (atHome && event.key === "Enter" && !event.shiftKey && home) {
        event.preventDefault();
        home();
        return;
      }
      if (!rows.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (atHome && event.key === "ArrowUp") return;
        const next = Math.max(
          0,
          Math.min(
            atHome ? 0 : index + (event.key === "ArrowDown" ? 1 : -1),
            rows.length - 1,
          ),
        );
        if (!atHome && index === 0 && event.key === "ArrowUp" && home) {
          setAtHome(true);
          return;
        }
        setAtHome(false);
        indexHint.current = next;
        setIdentity(rows[next]!.id);
        const rail = event.currentTarget;
        requestAnimationFrame(() =>
          rail
            .querySelector<HTMLElement>(
              `[data-result-id="${CSS.escape(rows[next]!.id)}"]`,
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
  }, [enabled, rows, index, handlerRef, onOpen, atHome, home]);
  return {
    selectedId: atHome ? null : selectedId,
    select: (row: DiscoveryRow) => {
      setAtHome(false);
      setIdentity(row.id);
    },
  };
}
