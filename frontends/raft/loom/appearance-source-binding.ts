import {useOptionalAppTheme as useDeviceTheme} from "../packages/web/src/hooks/useAppTheme";
/** Adapt the official hook shape; the existing device provider remains the sole owner. */
export function useOptionalAppTheme() {
  const theme = useDeviceTheme();
  return theme ? {mode: theme.preferences.mode, setMode: theme.setMode} : null;
}
