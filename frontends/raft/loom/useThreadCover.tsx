import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { hasUnresolvedIntents } from "@rah-os/client-core/write-intent";
import { OfficialThreadCoverTabs } from "./OfficialThreadCover138.generated.js";
/** Presentation binding of official merged cover cards. Both existing React surfaces remain mounted. */
export function useThreadCover(
  rootId: string | undefined,
  companion: "tasks" | "files" | undefined,
  blocked: boolean,
) {
  const host = useRef<HTMLDivElement>(null),
    back = useRef<(() => void) | null>(null);
  const [covering, setCovering] = useState(false),
    [active, setActive] = useState("thread"),
    [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    if (!rootId || !companion || blocked) {
      setCovering(false);
      return;
    }
    const node = host.current;
    if (!node) return;
    const measure = () => {
      const thread = node.querySelector<HTMLElement>(
        ":scope > .thread-side-column",
      );
      setCovering(!!thread && getComputedStyle(thread).position === "absolute");
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    const coarse = matchMedia("(pointer: coarse)");
    coarse.addEventListener("change", measure);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      coarse.removeEventListener("change", measure);
      window.removeEventListener("resize", measure);
    };
  }, [rootId, companion, blocked]);
  useLayoutEffect(() => {
    setActive("thread");
  }, [rootId, companion, covering]);
  const change = useCallback((tab: string) => {
    if (!hasUnresolvedIntents()) setActive(tab);
  }, []);
  const onOffset = useCallback((height: number) => setOffset(height), []);
  return {
    host,
    back,
    offset,
    onOffset,
    covering,
    active,
    header:
      covering && companion ? (
        <OfficialThreadCoverTabs
          side={{ tabs: ["thread", companion], activeTab: active }}
          entries={{ tasks: { title: "任务" }, files: { title: "工作区" } }}
          onChange={change}
          onBack={() => back.current?.()}
        />
      ) : undefined,
  };
}
