import { NativeCommands } from "./commands.ts";
import axios from "axios";
import { HttpRahClient } from "@rah-os/client-sdk";
import { pageFetch } from "../loom/page-fetch.ts";
import { NativeReadBridge } from "./read-bridge.ts";
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
    const data =
      method === "get"
        ? await bridge.read(config.url ?? "", config.params)
        : await commands.write(
            method,
            config.url ?? "",
            typeof config.data === "string"
              ? JSON.parse(config.data)
              : config.data,
          );
    return { data, status: 200, statusText: "OK", headers: {}, config };
  },
});
export async function clearAuthAndRedirect() {
  window.location.reload();
}
export default api;
