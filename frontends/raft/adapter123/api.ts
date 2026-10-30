import { NativeCommands } from "./commands.ts";
import axios from "axios";
import { HttpRahClient } from "@rah-os/client-sdk";
import { pageFetch } from "../loom/page-fetch.ts";
import { NativeReadBridge } from "./read-bridge.ts";
import { useServerStore } from "../upstream/web-1.21.23/packages/web/src/store/serverStore";
import { useChannelStore } from "../upstream/web-1.21.23/packages/web/src/store/channelStore";
import { conversationPreferences } from "./sidebar.ts";
export const client = new HttpRahClient({
  fetch: pageFetch,
  baseUrl: "",
  accessToken: () => "trusted-proxy-auth",
});
export const bridge = new NativeReadBridge(client);
export const commands = new NativeCommands(bridge);
const api = axios.create({
  adapter: async (config) => {
    if (config.method === "post" && config.url === "/feature-flags/evaluate") {
      const body =
        typeof config.data === "string" ? JSON.parse(config.data) : config.data;
      return {
        data: {
          evaluations: (body.keys ?? []).map((key: string) => ({
            key,
            enabled: false,
          })),
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    }
    const method = (config.method ?? "get").toLowerCase();
    const input =
      typeof config.data === "string" ? JSON.parse(config.data) : config.data;
    if (
      method === "patch" &&
      /^\/servers\/[^/]+\/sidebar-order$/.test(config.url ?? "")
    )
      input.loomPrefsVersion =
        useServerStore.getState().sidebarOrder.sectionsVersion;
    let data;
    try {
      data =
        method === "get"
          ? await bridge.read(config.url ?? "", config.params)
          : await commands.write(method, config.url ?? "", input);
      if (
        method !== "get" &&
        data &&
        typeof (data as any).prefsVersion === "number"
      ) {
        const version = (data as any).prefsVersion;
        useServerStore.setState((state) => ({
          sidebarOrder: {
            ...state.sidebarOrder,
            sectionsVersion: version,
            pinnedVersion: version,
          },
        }));
        const preferences = (data as any).loomPreferences;
        if (preferences) {
          useChannelStore.setState((state) => ({
            channels: conversationPreferences(state.channels, preferences),
            dmChannels: conversationPreferences(state.dmChannels, preferences),
          }));
          delete (data as any).loomPreferences;
        }
      }
    } catch (error: any) {
      // Native stores inspect Axios status for known refusals (not unknown writes).
      if (typeof error.status === "number")
        error.response = {
          status: error.status,
          data: { error: error.message },
        };
      throw error;
    }
    return { data, status: 200, statusText: "OK", headers: {}, config };
  },
});
export async function clearAuthAndRedirect() {
  window.location.reload();
}
export default api;
