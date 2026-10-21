import { useTopbarSearchWidth } from "./useTopbarSearchWidth.ts";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
// Structural port of v1.21.22 app-shell-D1-nY-va.js Gbt/Kbt.
// Native classes and geometry retained; single local workspace replaces Raft accounts.
import { useEffect, useRef } from "react";
import {
  SearchTrigger as OfficialSearchTrigger,
  SearchTriggerLabel,
  SearchTriggerShortcut,
} from "raft-ui";
import { Kbd } from "raft-ui";
import { Search } from "lucide-react";
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
    <div
      data-testid="app-top-bar"
      className="relative flex h-12 w-full shrink-0 items-center border-b border-line-seam bg-layer-frame text-foreground-on-frame    "
    >
      <div
        ref={leading}
        className="flex min-w-0 flex-1 items-center px-2"
        style={{
          marginRight:
            "max(0px, calc((var(--raft-titlebar-inset-end, 0px) + 16px) - (var(--raft-titlebar-inset-start, 0px) + 16px)))",
        }}
      >
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
        <div
          data-topbar-leading-end
          className="ml-auto flex shrink-0 items-center gap-0.5 pl-2"
        />
      </div>
      <OfficialSearchTrigger
        ref={anchor}
        style={searchWidth === undefined ? undefined : { width: searchWidth }}
        onClick={onSearch}
        data-testid="app-top-bar-search"
      >
        <Search
          size={18}
          aria-hidden
          className="shrink-0 text-foreground-hint"
        />
        <SearchTriggerLabel>搜索</SearchTriggerLabel>
        <SearchTriggerShortcut>
          <Kbd>{navigator.platform.includes("Mac") ? "⌘ K" : "Ctrl K"}</Kbd>
        </SearchTriggerShortcut>
      </OfficialSearchTrigger>
      <div
        ref={trailing}
        className="flex min-w-0 flex-1 items-center justify-end gap-1 px-2"
        style={{
          marginLeft:
            "max(0px, calc((var(--raft-titlebar-inset-start, 0px) + 16px) - (var(--raft-titlebar-inset-end, 0px) + 16px)))",
        }}
      >
        <SystemNotifications flavor="top-bar" />
      </div>
    </div>
  );
}
