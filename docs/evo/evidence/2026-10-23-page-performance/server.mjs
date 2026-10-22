import { createServer, request } from "node:http";
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
const dir = "/Users/sun/.loom/reviews/2026-10-23-page-performance";
const roots = {
  before:
    "/Users/sun/Code/repos/rah_os/.workbench-web/26c2c2818d592e4843df1092c698c3daae1ad9e938b8a7e8ac685496d31b6c4c",
  after:
    "/Users/sun/Code/repos/rah_os/.workbench-web/633b9d1d9b4ec5d62862761b3b695e2b52c460f56116404f454021a5a2146547",
};
const upstream = "http://127.0.0.1:4176";
const cookie =
  (await fetch(upstream)).headers.get("set-cookie")?.split(";")[0] || "";
const types = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
let port = 51810;
for (const arm of ["before", "after"])
  for (const cache of ["cold", "warm"]) {
    const root = roots[arm],
      label = arm + "-" + cache;
    createServer(async (req, res) => {
      const path = new URL(req.url, "http://localhost").pathname;
      if (path === "/bench-result") {
        let body = "";
        for await (const c of req) body += c;
        appendFileSync(
          dir + "/results.jsonl",
          JSON.stringify({ arm, cache, at: Date.now(), ...JSON.parse(body) }) +
            "\n",
        );
        res.end("ok");
        return;
      }
      if (path === "/bench-probe.js") {
        res.setHeader("content-type", "text/javascript");
        res.end(readFileSync(dir + "/probe.js"));
        return;
      }
      if (
        path.startsWith("/v3/") ||
        path.startsWith("/v1/") ||
        path.startsWith("/_rah/")
      ) {
        if (
          req.method !== "GET" &&
          !/(?:\/list|\/get|\/read|\/sync|\/context|\/summary|\/social|\/global|\/configuration|\/resolve|\/search|\/overview|\/catalog|\/me|\/profile|\/humans|\/timeline|\/member-graph|\/preview|\/history|\/saved|\/acknowledge)$/.test(
            path,
          )
        ) {
          appendFileSync(
            dir + "/blocked.jsonl",
            JSON.stringify({ path, method: req.method }) + "\n",
          );
          res.writeHead(403, { "content-type": "application/json" });
          res.end('{"error":"read-only benchmark"}');
          return;
        }
        appendFileSync(
          dir + "/requests.jsonl",
          JSON.stringify({ arm, cache, path, at: Date.now() }) + "\n",
        );
        const u = request(
          upstream + req.url,
          {
            method: req.method,
            headers: {
              ...req.headers,
              "accept-encoding":
                arm === "before"
                  ? "identity"
                  : req.headers["accept-encoding"] || "identity",
              host: "127.0.0.1:4176",
              origin: upstream,
              cookie,
            },
          },
          (r) => {
            res.writeHead(r.statusCode, r.headers);
            r.pipe(res);
          },
        );
        u.on("error", () => {
          if (!res.headersSent) res.writeHead(502);
          res.end();
        });
        res.on("close", () => u.destroy());
        req.pipe(u);
        return;
      }
      let file = resolve(root, "." + path);
      if (!file.startsWith(root + "/") && file !== root) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (path === "/" || !existsSync(file)) file = join(root, "index.html");
      let body = readFileSync(file);
      if (extname(file) === ".html")
        body = Buffer.from(
          body
            .toString()
            .replace("<head>", '<head><script src="/bench-probe.js"></script>'),
        );
      res.setHeader(
        "content-type",
        types[extname(file)] || "application/octet-stream",
      );
      res.setHeader(
        "cache-control",
        cache === "cold" || extname(file) === ".html"
          ? "no-store"
          : "public,max-age=3600",
      );
      if (
        /\.(js|css|html|json|svg)$/.test(file) &&
        String(req.headers["accept-encoding"]).includes("gzip")
      ) {
        body = gzipSync(body);
        res.setHeader("content-encoding", "gzip");
      }
      res.setHeader("content-length", body.length);
      res.end(body);
    }).listen(port, "127.0.0.1");
    console.log(label + " http://127.0.0.1:" + port++);
  }
