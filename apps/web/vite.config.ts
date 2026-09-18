import { pdfAssetsPlugin } from "./pdf-assets-plugin.ts";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ResolvedConfig } from "vite";
import { webBuildOutput } from "./build-output.ts";
// The release identity resolver is shared, untyped build tooling. The Web app
// itself never imports it; only this build config does.
// @ts-expect-error -- plain ESM build script without type declarations
import * as releaseIdentity from "../../scripts/release-version.mjs";

const BUILD_IDENTITY_META_NAME: string =
  releaseIdentity.BUILD_IDENTITY_META_NAME;
const encodeBuildIdentityMeta: (value: unknown) => string =
  releaseIdentity.encodeBuildIdentityMeta;

// One release identity per build. `RAH_OS_BUILD_IDENTITY` (already resolved by
// a parent build step) wins; otherwise `RAH_OS_RELEASE_VERSION` declares a
// formal build and its absence means a development bundle. There is no
// fallback to a placeholder release version.
const buildIdentity: unknown = releaseIdentity.buildIdentityForEnvironment(
  process.env,
);

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

// Development has no LAN edge. Match the loopback gateway's read-only
// capability response instead of making Settings depend on a missing route.
function loopbackCapabilityPlugin(): Plugin {
  return {
    name: "rah-loopback-capability",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (
          request.method !== "GET" ||
          request.url?.split("?", 1)[0] !== "/_rah/session"
        ) {
          next();
          return;
        }
        response.setHeader("content-type", "application/json");
        response.setHeader("cache-control", "no-store");
        response.end(JSON.stringify({ available: false }));
      });
    },
  };
}

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
        {
          // Base64 so the payload is safe in an attribute and a product build
          // can verify the Web bundle carries the same identity as the Core.
          tag: "meta",
          attrs: {
            name: BUILD_IDENTITY_META_NAME,
            content: encodeBuildIdentityMeta(buildIdentity),
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
      // The bundle records its own release identity next to the content hash so
      // the workbench launcher can hand the very same identity to the daemon
      // and the product build can verify Core and Web are one artefact.
      await writeFile(
        join(outputDirectory, ".rah-web-build.json"),
        `${JSON.stringify(
          { buildIdentity, schemaVersion: 1, webBuildId },
          null,
          2,
        )}\n`,
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
      __RAH_BUILD_IDENTITY__: JSON.stringify(JSON.stringify(buildIdentity)),
      __RAH_TRUSTED_PROXY_AUTH__: JSON.stringify(
        productionTrustedProxyAuth ||
          (command === "serve" && developmentAccessToken !== undefined),
      ),
    },
    plugins: [
      react(),
      pdfAssetsPlugin(),
      loopbackCapabilityPlugin(),
      webBuildMetadataPlugin(command),
    ],
    server: {
      port: Number(process.env.RAH_WEB_PORT ?? "4173"),
      proxy: {
        "/v1/local": daemonProxy(),
        "/v3/client": daemonProxy(),
      },
    },
  };
});
