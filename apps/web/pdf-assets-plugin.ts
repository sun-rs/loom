import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";
const root = dirname(
  createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
);
const folders = ["cmaps", "standard_fonts", "wasm", "iccs"];
/** Ship pinned PDF parser assets locally, including upstream license notices. */
export function pdfAssetsPlugin(): Plugin {
  return {
    name: "rah-pdf-assets",
    async generateBundle() {
      for (const folder of folders)
        for (const name of await readdir(join(root, folder))) {
          this.emitFile({
            type: "asset",
            fileName: `pdfjs-assets/${folder}/${name}`,
            source: await readFile(join(root, folder, name)),
          });
        }
      this.emitFile({
        type: "asset",
        fileName: "legal/pdfjs-license.txt",
        source: await readFile(join(root, "LICENSE")),
      });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match =
          /^\/pdfjs-assets\/(cmaps|standard_fonts|wasm|iccs)\/([A-Za-z0-9_.-]+)$/.exec(
            req.url ?? "",
          );
        if (!match || !["GET", "HEAD"].includes(req.method ?? ""))
          return next();
        void readFile(join(root, match[1]!, match[2]!))
          .then((bytes) => {
            res.setHeader(
              "Content-Type",
              match[2]!.endsWith(".wasm")
                ? "application/wasm"
                : "application/octet-stream",
            );
            res.end(req.method === "HEAD" ? undefined : bytes);
          })
          .catch(() => {
            res.statusCode = 404;
            res.end();
          });
      });
    },
  };
}
