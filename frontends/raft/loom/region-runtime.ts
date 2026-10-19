// Device display preferences only; native time formatters retain one settings projection.
import { useTranslationStore } from "../packages/web/src/store/translationStore.ts";
import {
  detectBrowserTimeFormat,
  detectBrowserTimezone,
} from "../packages/web/src/utils/timeFormatting.ts";
import {
  readRegion,
  saveRegion,
  REGION_KEY,
  type RegionPreferences,
} from "./region-preferences.ts";
function publish(value: RegionPreferences) {
  useTranslationStore.setState((state) => ({
    settings: {
      ...state.settings,
      preferredTimezone: value.timezone,
      effectiveTimezone: value.timezone ?? detectBrowserTimezone(),
      preferredTimeFormat: value.timeFormat,
      effectiveTimeFormat: value.timeFormat ?? detectBrowserTimeFormat(),
      preferredTranslationMode: "off",
      available: false,
    },
  }));
}
export function saveDeviceRegion(value: RegionPreferences) {
  saveRegion(localStorage, value);
  publish(value);
}
export function initializeDeviceRegion() {
  try {
    publish(readRegion(localStorage));
  } catch {}
  window.addEventListener("storage", (event) => {
    if (event.key === REGION_KEY || event.key === null) {
      try {
        publish(readRegion(localStorage));
      } catch {}
    }
  });
}
