// Structural port of v1.21.16 app-shell-L7litFx-.js C_t/y_t/b_t/S_t.
// Native classes and geometry retained; single local workspace replaces Raft accounts.
import { useEffect, useRef } from "react";
import { Button, Kbd } from "raft-ui";
import { Search } from "lucide-react";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import { DESKTOP_SEARCH_ANCHOR_VARS } from "../packages/web/src/components/search/searchOverlayAnchor.ts";
export default function TopBar({
  name,
  onSearch,
}: {
  name: string;
  onSearch: () => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
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
      className="relative flex h-12 w-full shrink-0 items-center border-b border-line-muted bg-layer-panel text-foreground-strong theme-brutal:border-b-2 theme-brutal:border-black theme-brutal:bg-soft-signal theme-brutal:text-black"
    >
      <div
        className="flex min-w-0 flex-1 items-center px-3"
        style={{
          marginRight:
            "max(0px, calc((var(--raft-titlebar-inset-end, 0px) + 24px) - (var(--raft-titlebar-inset-start, 0px) + 24px)))",
        }}
      >
        <div className="relative flex min-w-0 w-fit shrink">
          <Button
            variant="ghost"
            size="sm"
            disabled
            aria-label={name}
            data-testid="desktop-workspace-trigger"
            className="min-w-0 shrink justify-start gap-2 overflow-hidden [&>[data-slot=button-content]]:min-w-0 [&>[data-slot=button-content]]:max-w-full [&>[data-slot=button-content]]:overflow-hidden"
          >
            <AvatarSlot
              context="creator-link"
              type="server"
              serverInitial={name.slice(0, 1).toUpperCase() || "L"}
              className="shrink-0"
            />
            <span
              data-workspace-name
              className="min-w-0 max-w-[160px] truncate font-display text-sm font-bold"
            >
              {name}
            </span>
          </Button>
        </div>
        <div
          data-topbar-leading-end
          className="ml-auto flex shrink-0 items-center gap-0.5 pl-2"
        />
      </div>
      <Button
        ref={anchor}
        variant="outline"
        size="sm"
        onClick={onSearch}
        data-testid="app-top-bar-search"
        className="w-[clamp(360px,32vw,520px)] shrink-0 transition-[color,background-color,border-color,box-shadow,translate,scale] justify-start gap-2 font-normal text-foreground-muted [&>[data-slot=button-content]]:flex [&>[data-slot=button-content]]:w-full [&>[data-slot=button-content]]:items-center [&>[data-slot=button-content]]:gap-2"
      >
        <Search
          size={15}
          aria-hidden
          className="shrink-0 text-foreground-strong theme-brutal:text-black"
        />
        <span className="truncate">搜索</span>
        <Kbd className="ml-auto shrink-0">
          {navigator.platform.includes("Mac") ? "⌘ K" : "Ctrl K"}
        </Kbd>
      </Button>
      <div
        className="flex min-w-0 flex-1 items-center justify-end gap-1 pl-3 pr-3"
        style={{
          marginLeft:
            "max(0px, calc((var(--raft-titlebar-inset-start, 0px) + 24px) - (var(--raft-titlebar-inset-end, 0px) + 24px)))",
        }}
      />
    </div>
  );
}
