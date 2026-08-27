import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const daemonTarget = process.env.RAH_DAEMON_URL ?? "http://127.0.0.1:7314";
const developmentAccessToken = process.env.RAH_DEV_ACCESS_TOKEN;
const productionTrustedProxyAuth =
  process.env.RAH_WEB_TRUSTED_PROXY_AUTH === "1";

function daemonProxy() {
  return {
    changeOrigin: false,
    configure(proxy: {
      on: (
        event: "proxyReq",
        listener: (proxyRequest: {
          setHeader: (name: string, value: string) => void;
        }) => void,
      ) => void;
    }) {
      if (developmentAccessToken === undefined) return;
      proxy.on("proxyReq", (proxyRequest) => {
        proxyRequest.setHeader(
          "authorization",
          `Bearer ${developmentAccessToken}`,
        );
      });
    },
    target: daemonTarget,
  };
}

export default defineConfig(({ command }) => ({
  define: {
    __RAH_TRUSTED_PROXY_AUTH__: JSON.stringify(
      productionTrustedProxyAuth ||
        (command === "serve" && developmentAccessToken !== undefined),
    ),
  },
  plugins: [react()],
  server: {
    port: Number(process.env.RAH_WEB_PORT ?? "4173"),
    proxy: {
      "/v1/local": daemonProxy(),
      "/v3/client": daemonProxy(),
    },
  },
}));
