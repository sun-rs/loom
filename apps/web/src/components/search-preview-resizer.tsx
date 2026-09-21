import { useEffect, useState } from "react";
import { PanelResizer } from "@rah-os/ui-web/neo-brutalist/panel-resizer";
import {
  discoveryWidthPolicy,
  discoveryWidthKey,
  readDiscoveryWidth,
} from "../discovery-width.ts";
// Raft Zw + iQe: independent wide (400..720,560) and compact (320..480,320)
// layout preferences. Shared PanelResizer owns capture, keyboard and cancellation.
export function useSearchPreviewWidth(forceCompact = false) {
  const [viewport, setViewport] = useState(window.innerWidth);
  const read = (compact: boolean) => {
    try {
      return readDiscoveryWidth(window.localStorage, compact);
    } catch {
      return compact ? 320 : 560;
    }
  };
  const [wide, setWide] = useState(() => read(false));
  const [small, setSmall] = useState(() => read(true));
  useEffect(() => {
    const update = () => setViewport(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const { compact, min, max, defaultWidth } = discoveryWidthPolicy(
    viewport,
    forceCompact,
  );
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  const width = clamp(compact ? small : wide);
  const setWidth = compact ? setSmall : setWide;
  const commit = (v: number) => {
    try {
      localStorage.setItem(discoveryWidthKey(compact), String(v));
    } catch {
      /* Optional layout preference. */
    }
  };
  const reset = () => {
    setWidth(defaultWidth);
    commit(defaultWidth);
  };
  return { width, min, max, clamp, setWidth, commit, reset };
}
export function SearchPreviewResizer({
  layout,
  label = "调整搜索结果宽度",
}: {
  label?: string;
  layout: ReturnType<typeof useSearchPreviewWidth>;
}) {
  return (
    <PanelResizer
      label={label}
      onWidthReset={layout.reset}
      className="rah-search-resizer"
      width={layout.width}
      onWidthChange={layout.setWidth}
      onWidthCommit={layout.commit}
      direction={1}
      min={layout.min}
      max={layout.max}
      clamp={layout.clamp}
      nextWidth={(v, key) =>
        key === "Home"
          ? layout.min
          : key === "End"
            ? layout.max
            : key === "ArrowLeft"
              ? layout.clamp(v - 8)
              : key === "ArrowRight"
                ? layout.clamp(v + 8)
                : undefined
      }
    />
  );
}
