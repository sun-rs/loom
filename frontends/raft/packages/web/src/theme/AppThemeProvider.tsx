// Loom port to the official raft-ui 0.6 mode-only provider. Original revision: adoption.json.
import { useLayoutEffect, useEffect, useState, type ReactNode } from "react";
import { ThemeProvider, useTheme } from "raft-ui";
import { AppThemeContext } from "../hooks/useAppTheme";
import {
  readMode,
  modeKey,
  type AppearanceMode,
} from "../../../../loom/theme-mode";
function ModeContext({
  children,
  mode,
  setMode,
}: {
  children: ReactNode;
  mode: AppearanceMode;
  setMode: (mode: AppearanceMode) => void;
}) {
  const { resolvedMode } = useTheme();
  useLayoutEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (meta)
      meta.content = getComputedStyle(document.documentElement)
        .getPropertyValue("--layer-canvas")
        .trim();
  }, [resolvedMode]);
  return (
    <AppThemeContext.Provider
      value={{ preferences: { mode }, resolvedMode, setMode }}
    >
      {children}
    </AppThemeContext.Provider>
  );
}
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setState] = useState<AppearanceMode>(() =>
    readMode(window.localStorage),
  );
  const setMode = (next: AppearanceMode) => {
    setState(next);
    try {
      localStorage.setItem(modeKey, next);
    } catch {
      /* in-memory mode remains usable */
    }
  };
  useEffect(() => {
    const update = (e: StorageEvent) => {
      if (e.key === modeKey || e.key === null) setState(readMode(localStorage));
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);
  return (
    <ThemeProvider mode={mode} onModeChange={setMode} storageKey={modeKey}>
      <ModeContext mode={mode} setMode={setMode}>
        {children}
      </ModeContext>
    </ThemeProvider>
  );
}
export { useAppTheme } from "../hooks/useAppTheme";
