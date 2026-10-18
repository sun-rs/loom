import { createContext, useContext } from "react";
import type { AppearanceMode } from "../../../../loom/theme-mode";
export interface AppThemeContextValue {
  preferences: { mode: AppearanceMode };
  resolvedMode: "light" | "dark";
  setMode: (mode: AppearanceMode) => void;
}
export const AppThemeContext = createContext<AppThemeContextValue | null>(null);
export function useAppTheme() {
  const value = useContext(AppThemeContext);
  if (!value) throw Error("AppThemeProvider required");
  return value;
}
export function useOptionalAppTheme() {
  return useContext(AppThemeContext);
}
