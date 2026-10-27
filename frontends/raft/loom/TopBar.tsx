import { OfficialTopBar } from "./OfficialTopBar.generated";
import { useTopbarSearchWidth } from "./useTopbarSearchWidth.ts";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
// Official generated shell; local single-workspace identity and resource-based adaptive width.
import { useEffect, useRef } from "react";
import { Kbd } from "raft-ui";
import SystemNotifications from "./SystemNotifications.tsx";
import { DESKTOP_SEARCH_ANCHOR_VARS } from "../packages/web/src/components/search/searchOverlayAnchor.ts";
export default function TopBar({
  name,
  onSearch,
}: {
  name: string;
  onSearch: () => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const leading = useRef<HTMLDivElement>(null),
    trailing = useRef<HTMLDivElement>(null);
  const searchWidth = useTopbarSearchWidth(anchor, leading, trailing);
  useEffect(() => {
    const el = anchor.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => {
      const r = el.getBoundingClientRect();
      // A consolidated touch header has no search-field anchor. Use the
      // official overlay's fallback rather than publishing a zero-size field.
      if (r.width === 0) {
        root.style.removeProperty(DESKTOP_SEARCH_ANCHOR_VARS.top);
        root.style.removeProperty(DESKTOP_SEARCH_ANCHOR_VARS.width);
        return;
      }
      root.style.setProperty(
        DESKTOP_SEARCH_ANCHOR_VARS.top,
        `${Number(r.top.toFixed(3))}px`,
      );
      root.style.setProperty(
        DESKTOP_SEARCH_ANCHOR_VARS.width,
        `${Number(r.width.toFixed(3))}px`,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      root.style.removeProperty(DESKTOP_SEARCH_ANCHOR_VARS.top);
      root.style.removeProperty(DESKTOP_SEARCH_ANCHOR_VARS.width);
    };
  }, []);
  return (
    <OfficialTopBar
      leadingRef={leading}
      trailingRef={trailing}
      searchFieldRef={anchor}
      searchWidth={searchWidth}
      openSearch={onSearch}
      shortcut={
        <Kbd>{navigator.platform.includes("Mac") ? "⌘ K" : "Ctrl K"}</Kbd>
      }
      trailing={<SystemNotifications flavor="top-bar" />}
      identity={
        <div className="relative flex min-w-0 w-fit shrink">
          {/* Single-workspace adaptation: omit the unsupported organization switch action. */}
          <div
            data-testid="desktop-workspace-trigger"
            className="flex h-9 min-w-0 shrink items-center justify-start gap-2 rounded-control px-2.5 font-sans font-bold text-subhead text-foreground-on-frame hover:bg-fill-frame-pressed active:bg-fill-frame-pressed"
            title={name}
          >
            <AvatarSlot
              context="creator-link"
              type="server"
              serverInitial={name.slice(0, 1).toUpperCase() || "L"}
              className="shrink-0"
            />
            <span
              data-workspace-name
              className="min-w-0 max-w-[160px] truncate"
            >
              {name}
            </span>
          </div>
        </div>
      }
    />
  );
}
