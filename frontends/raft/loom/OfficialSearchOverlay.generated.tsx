// GENERATED from locked db5e399 SearchOverlay. Only imports bind Loom; body unchanged.
import { useEffect, useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import { useIntl } from "react-intl";
import { DialogSurface, Kbd } from "raft-ui";
import MessageSearchPage from "./SearchOverlayContent";
import { searchOverlayCardStyle, searchOverlayColumnFromRect } from "@loom/raft-web-source/searchOverlayAnchor";
import type { SearchOverlayColumn } from "@loom/raft-web-source/searchOverlayAnchor";
import { isElectronDesktopShell } from "../packages/web/src/utils/desktopShell";
import Modal from "@loom/raft-web-source/Modal";
const ARROW_UP_GLYPH = "↑";
const ARROW_DOWN_GLYPH = "↓";
const RETURN_KEY_GLYPH = "↵";
function stopMouseDownPropagation(e: React.MouseEvent) {
  e.stopPropagation();
}
function useWebContentColumn(columnRef: RefObject<HTMLElement | null> | null): SearchOverlayColumn | null {
  const [column, setColumn] = useState<SearchOverlayColumn | null>(null);
  useLayoutEffect(() => {
    if (isElectronDesktopShell()) return;
    const el = columnRef?.current;
    if (!el) return;
    const measure = () => {
      const next = searchOverlayColumnFromRect(el.getBoundingClientRect());
      setColumn((prev) => (prev && prev.top === next.top ? prev : next));
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); };
  }, [columnRef]);
  return column;
}
export default function SearchOverlay({ onClose, contentColumnRef }: {
  onClose: () => void;
  /** Web: the content column the panel sits at the top of (MainLayout's).
   *  Required so a missing wire fails to compile instead of silently falling
   *  back to the centred placement; pass null only where there is no column. */
  contentColumnRef: RefObject<HTMLElement | null> | null;
}) {
  const { formatMessage } = useIntl();
  const column = useWebContentColumn(contentColumnRef);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      onClose();
    };
    // keydown-global-exempt: modal Escape-to-dismiss for the search overlay,
    // guarded by defaultPrevented (the search's filter-menu Escape wins) + IME.
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    // A centred modal like every other: the page dims behind it and the
    // panel is the dialog frame, with no open animation.
    <Modal onClose={onClose} closeOnBackdrop closeOnEscape={false} layer={1}>
      {/*
        Fixed size + position (Slack command-palette pattern): a constant height
        so the frame never grows/shrinks or re-centers as the query and result
        count change — MessageSearchPage fills it (flex-1) and its result list
        scrolls internally. Placement is ANCHORED to the desktop top-bar search
        field via CSS variables (see searchOverlayAnchor.ts): top edge on the
        field, centred on the window, so the panel reads as the field expanding — with a
        centred 8vh fallback wherever the shell publishes no anchor.
      */}
      <DialogSurface
        role="dialog"
        aria-modal="true"
        data-testid="desktop-search-overlay"
        className="min-h-0"
        style={searchOverlayCardStyle(column)}
        onMouseDown={stopMouseDownPropagation}
      >
        <MessageSearchPage activateResultsInChat overlayChrome />
        {/* Palette footer (task #113, Slack's "↑↓ Select"): the keyboard contract
            in one quiet line; Esc already sits in the field. */}
        <div
          data-testid="desktop-search-overlay-footer"
          className="flex shrink-0 items-center gap-4 border-t border-line-seam px-3 py-2 text-caption text-foreground-hint"
        >
          <span className="flex items-center gap-1">
            <Kbd aria-hidden="true">{ARROW_UP_GLYPH}</Kbd>
            <Kbd aria-hidden="true">{ARROW_DOWN_GLYPH}</Kbd>
            <span>{formatMessage({ id: "search.overlay.footerSelect" })}</span>
          </span>
          <span className="flex items-center gap-1">
            <Kbd aria-hidden="true">{RETURN_KEY_GLYPH}</Kbd>
            <span>{formatMessage({ id: "search.overlay.footerOpen" })}</span>
          </span>
        </div>
      </DialogSurface>
    </Modal>
  );
}
