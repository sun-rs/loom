import { useEffect } from "react";
import type { RahClient } from "@rah-os/client-sdk";

import {
  browserPushReconciliation,
  browserPushSupported,
  disableBrowserPush,
  enableBrowserPush,
  readBrowserPushPreference,
  readBrowserPushStatus,
} from "./web-push-client.ts";

/**
 * Web Push is a device preference that defaults on. Browsers require the
 * native permission request to run inside a user gesture, so an undecided
 * browser is prompted on the first product click rather than during load.
 */
export function useDefaultWebPush(client: RahClient) {
  useEffect(() => {
    if (!browserPushSupported()) return;
    let disposed = false;

    const reconcile = async () => {
      const status = await readBrowserPushStatus(client);
      if (disposed) return;
      const operation = browserPushReconciliation({
        ...status,
        desired: readBrowserPushPreference(window.localStorage),
      });
      if (operation === "subscribe") await enableBrowserPush(client, false);
      if (operation === "unsubscribe") await disableBrowserPush(client);
    };
    const reconcileQuietly = () => {
      void reconcile().catch(() => undefined);
    };
    const requestOnFirstClick = () => {
      window.removeEventListener("click", requestOnFirstClick);
      if (
        disposed ||
        !readBrowserPushPreference(window.localStorage) ||
        Notification.permission !== "default"
      )
        return;
      // Notification.requestPermission() is invoked synchronously inside this
      // click callback before enableBrowserPush performs later async work.
      void enableBrowserPush(client, true).catch(() => undefined);
    };

    if (
      readBrowserPushPreference(window.localStorage) &&
      Notification.permission === "default"
    )
      window.addEventListener("click", requestOnFirstClick);
    reconcileQuietly();
    window.addEventListener("focus", reconcileQuietly);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") reconcileQuietly();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      window.removeEventListener("click", requestOnFirstClick);
      window.removeEventListener("focus", reconcileQuietly);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [client]);
}
