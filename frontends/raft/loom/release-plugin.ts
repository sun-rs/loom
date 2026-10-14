// Loom release identity infrastructure retained independently of the retired UI.
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
// @ts-expect-error -- shared ESM release tooling has no declaration file
import * as releaseIdentity from "../../../scripts/release-version.mjs";
const BUILD_IDENTITY_META_NAME: string =
  releaseIdentity.BUILD_IDENTITY_META_NAME;
const encodeBuildIdentityMeta: (value: unknown) => string =
  releaseIdentity.encodeBuildIdentityMeta;
const buildIdentity: unknown = releaseIdentity.buildIdentityForEnvironment(
  process.env,
);
const WEB_BUILD_META_PLACEHOLDER = "__RAH_CONTENT_DERIVED_WEB_BUILD_ID__";
export const webBuildDefines = {
  __RAH_BUILD_IDENTITY__: JSON.stringify(JSON.stringify(buildIdentity)),
};
export function webBuildMetadataPlugin(command: "build" | "serve"): Plugin {
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
