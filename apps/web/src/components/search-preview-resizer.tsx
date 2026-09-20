import { useEffect, useState } from "react";
import { PanelResizer } from "@rah-os/ui-web/neo-brutalist/panel-resizer";
// Raft Zw + iQe: independent wide (400..720,560) and compact (320..480,320)
// layout preferences. Shared PanelResizer owns capture, keyboard and cancellation.
export function useSearchPreviewWidth(scope = "search", forceCompact = false) {
  const [viewport, setViewport] = useState(window.innerWidth);
  const read = (key: string, fallback: number, min: number, max: number) => {
    try {
      const v = Number(localStorage.getItem(key));
      return v >= min && v <= max ? v : fallback;
    } catch {
      return fallback;
    }
  };
  const [wide, setWide] = useState(() =>
    read(`rah:${scope}-width`, 560, 400, 720),
  );
  const [small, setSmall] = useState(() =>
    read(`rah:${scope}-compact-width`, 320, 320, 480),
  );
  useEffect(() => {
    const update = () => setViewport(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const compact = forceCompact || viewport < 1024,
    min = compact ? 320 : 400,
    max = Math.max(min, Math.min(compact ? 480 : 720, viewport - 64 - 400));
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  const width = clamp(compact ? small : wide);
  const setWidth = compact ? setSmall : setWide;
  const commit = (v: number) => {
    try {
      localStorage.setItem(
        compact ? `rah:${scope}-compact-width` : `rah:${scope}-width`,
        String(v),
      );
    } catch {
      /* Optional layout preference. */
    }
  };
  return { width, min, max, clamp, setWidth, commit };
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
