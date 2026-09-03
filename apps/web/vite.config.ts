import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ResolvedConfig } from "vite";
import { webBuildOutput } from "./build-output.ts";

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

const WEB_BUILD_META_PLACEHOLDER = "__RAH_CONTENT_DERIVED_WEB_BUILD_ID__";

function webBuildMetadataPlugin(command: "build" | "serve"): Plugin {
  let resolvedConfig: ResolvedConfig | undefined;
  return {
    name: "rah-web-build-metadata",
    configResolved(config) {
      resolvedConfig = config;
    },
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: {
            name: "rah-web-build-id",
            content:
              command === "build" ? WEB_BUILD_META_PLACEHOLDER : "development",
          },
          injectTo: "head",
        },
      ];
    },
    async closeBundle() {
      if (command !== "build") return;
      if (resolvedConfig === undefined) {
        throw new Error(
          "Vite config was not resolved before Web build metadata",
        );
      }
      const outputDirectory = resolvedConfig.build.outDir;
      const files: Array<[string, Buffer]> = [];
      async function collect(directory: string): Promise<void> {
        for (const entry of (
          await readdir(directory, { withFileTypes: true })
        ).sort((left, right) => left.name.localeCompare(right.name))) {
          const absolutePath = join(directory, entry.name);
          if (entry.isDirectory()) await collect(absolutePath);
          else if (entry.isFile()) {
            const fileName = relative(outputDirectory, absolutePath).replaceAll(
              "\\",
              "/",
            );
            if (fileName !== ".rah-web-build.json") {
              files.push([fileName, await readFile(absolutePath)]);
            }
          } else {
            throw new Error("Web build output must contain regular files only");
          }
        }
      }
      await collect(outputDirectory);
      const hash = createHash("sha256");
      for (const [fileName, bytes] of files.sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        hash.update(JSON.stringify([fileName, bytes.byteLength])).update(bytes);
      }
      const webBuildId = hash.digest("hex");
      const indexPath = join(outputDirectory, "index.html");
      const index = await readFile(indexPath, "utf8");
      if (!index.includes(WEB_BUILD_META_PLACEHOLDER)) {
        throw new Error("Product index.html is missing Web build metadata");
      }
      await writeFile(
        indexPath,
        index.replace(WEB_BUILD_META_PLACEHOLDER, webBuildId),
      );
      await writeFile(
        join(outputDirectory, ".rah-web-build.json"),
        `${JSON.stringify({ schemaVersion: 1, webBuildId }, null, 2)}\n`,
      );
    },
  };
}

export default defineConfig(({ command }) => {
  return {
    build: {
      assetsInlineLimit: 0,
      manifest: true,
      outDir: webBuildOutput(productionTrustedProxyAuth),
    },
    define: {
      __RAH_TRUSTED_PROXY_AUTH__: JSON.stringify(
        productionTrustedProxyAuth ||
          (command === "serve" && developmentAccessToken !== undefined),
      ),
    },
    plugins: [react(), webBuildMetadataPlugin(command)],
    server: {
      port: Number(process.env.RAH_WEB_PORT ?? "4173"),
      proxy: {
        "/v1/local": daemonProxy(),
        "/v3/client": daemonProxy(),
      },
    },
  };
});
