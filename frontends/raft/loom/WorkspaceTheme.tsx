import { useLayoutEffect } from "react";
import { useTheme } from "raft-ui";
import type { RahClient } from "@rah-os/client-sdk";
import { useSidebarPreferences } from "./useSidebarPreferences";
import { resolveBrowserChromeColor } from "./OfficialPwa140.generated.js";
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
    const syncChrome = () => {
      const chrome = resolveBrowserChromeColor(
        "frame",
        root.classList.contains("dark") ? "dark" : "light",
      );
      if (meta && meta.content !== chrome) meta.content = chrome;
    };
    syncChrome();
    // Native ThemeProvider commits its mode class in a passive effect after
    // this child layout effect. Follow that DOM commit without a timer or a
    // second mode/theme state, so chrome cannot retain the previous mode color.
    const observer = new MutationObserver(syncChrome);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      root.removeAttribute("data-theme");
      root.removeAttribute("data-theme-decor");
    };
  }, [theme, decor, resolvedMode]);
  return null;
}
