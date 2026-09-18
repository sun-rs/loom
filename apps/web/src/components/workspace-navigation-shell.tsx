import { useMobileLayout } from "../use-mobile-layout.ts";
import { useEffect, useLayoutEffect, type ComponentProps } from "react";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { Rail } from "./workspace-navigation.tsx";

function useMobileCanvasTheme(mobile: boolean): void {
  useLayoutEffect(() => {
    if (!mobile) return;
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    const shell = document.querySelector(".rah-product-shell");
    if (!meta || !shell) return;
    const original = meta.content;
    // CSS owns the painted top edge; the meta color is a fallback for other browsers.
    const sync = () => {
      const color = getComputedStyle(document.documentElement).backgroundColor;
      if (meta.content !== color) meta.content = color;
    };
    const colorSurfaces =
      ".rah-task-detail-layer, .rah-channel-settings-layer, .rah-channel-settings-header";
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          ({ target, addedNodes, removedNodes }) =>
            target === shell ||
            target.parentNode === shell ||
            (target instanceof Element && target.matches(colorSurfaces)) ||
            [...addedNodes, ...removedNodes].some(
              (node) =>
                node instanceof Element &&
                (node.matches(colorSurfaces) ||
                  node.querySelector(colorSurfaces)),
            ),
        )
      )
        sync();
    });
    observer.observe(shell, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-mobile-index", "aria-label"],
    });
    sync();
    return () => {
      observer.disconnect();
      meta.content = original;
    };
  }, [mobile]);
}

/** Opt-in iOS keyboard measurement, enabled only with `?rahViewportDebug=1`.
 *  It reads geometry and writes `console.info`; it never moves scroll owners,
 *  changes the viewport contract or touches layout. The keyboard verdict must
 *  come from real iPhone numbers, not from a simulated viewport. */
function useViewportDiagnostics(): void {
  useEffect(() => {
    if (
      new URLSearchParams(window.location.search).get("rahViewportDebug") !==
      "1"
    )
      return;
    const visual = window.visualViewport ?? undefined;
    const rect = (selector: string) => {
      const node = document.querySelector(selector);
      if (node === null) return undefined;
      const box = node.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height };
    };
    const report = (reason: string) => {
      const composer = document.querySelector(".composer");
      console.info("[rah] viewport", {
        reason,
        innerHeight: window.innerHeight,
        clientHeight: document.documentElement.clientHeight,
        visualHeight: visual?.height,
        visualOffsetTop: visual?.offsetTop,
        visualPageTop: visual?.pageTop,
        visualScale: visual?.scale,
        activeElement: document.activeElement?.tagName,
        composer: rect(".composer"),
        composerPaddingBottom:
          composer === null
            ? undefined
            : getComputedStyle(composer).paddingBottom,
        mobileNav: rect(".rah-mobile-nav"),
        messages: rect(".messages"),
      });
    };
    const onVisual = () => report("visualViewport");
    const onWindow = () => report("window");
    visual?.addEventListener("resize", onVisual);
    visual?.addEventListener("scroll", onVisual);
    window.addEventListener("resize", onWindow);
    window.addEventListener("orientationchange", onWindow);
    report("initial");
    return () => {
      visual?.removeEventListener("resize", onVisual);
      visual?.removeEventListener("scroll", onVisual);
      window.removeEventListener("resize", onWindow);
      window.removeEventListener("orientationchange", onWindow);
    };
  }, []);
}

/** Shared destination actions; mobile root pages use the iOS reference tab bar. */
export function WorkspaceNavigation({
  homeOpen,
  onHome,
  ...props
}: ComponentProps<typeof Rail> & {
  homeOpen: boolean;
  onHome: () => void;
}) {
  useViewportDiagnostics();
  const mobile = useMobileLayout();
  useMobileCanvasTheme(mobile);
  if (!mobile) return <Rail {...props} />;
  const statusCanvas = (
    <div className="rah-mobile-status-canvas" aria-hidden="true" />
  );
  const active = props.active;
  if (
    !(active === "room" && homeOpen) &&
    active !== "tasks" &&
    active !== "agents" &&
    active !== "settings"
  )
    return statusCanvas;
  return (
    <>
      {statusCanvas}
      <nav className="rah-mobile-nav" aria-label="移动端主导航">
        {(
          [
            ["room", "home", "首页"],
            ["tasks", "task", "任务"],
            ["agents", "members", "成员"],
            ["settings", "gear", "设置"],
          ] as const
        ).map(([surface, icon, label]) => (
          <button
            key={surface}
            aria-label={label}
            type="button"
            aria-current={active === surface ? "page" : undefined}
            onClick={() =>
              surface === "room"
                ? onHome()
                : surface === "tasks"
                  ? props.onTasks?.()
                  : props.onSelect?.(surface)
            }
          >
            <Icon name={icon} />
          </button>
        ))}
      </nav>
    </>
  );
}
