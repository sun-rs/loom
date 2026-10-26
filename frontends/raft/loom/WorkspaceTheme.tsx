import { useLayoutEffect } from "react";
import { useTheme } from "raft-ui";
import type { RahClient } from "@rah-os/client-sdk";
import { useSidebarPreferences } from "./useSidebarPreferences";
/** Canonical Human × Workspace preference projection. Device mode has its own owner. */
export default function WorkspaceTheme({
  client,
  workspaceId,
}: {
  client: RahClient;
  workspaceId?: string;
}) {
  const { preferences } = useSidebarPreferences(client, workspaceId);
  const { resolvedMode } = useTheme();
  const theme = preferences?.theme ?? "raft",
    decor = preferences?.themeDecor !== false;
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme === "raft") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-decor", decor ? "on" : "off");
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (meta)
      meta.content = getComputedStyle(root)
        .getPropertyValue("--layer-frame")
        .trim();
    return () => {
      root.removeAttribute("data-theme");
      root.removeAttribute("data-theme-decor");
    };
  }, [theme, decor, resolvedMode]);
  return null;
}
