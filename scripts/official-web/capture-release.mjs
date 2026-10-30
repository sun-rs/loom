import ts from "typescript";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
const origin = "https://app.raft.build";
const hosts = new Set([
  "app.raft.build",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);
const extensions =
  /\.(?:js|mjs|css|json|webmanifest|woff2?|ttf|otf|svg|png|jpe?g|gif|webp|ico|wasm|mp3|ogg|wav)$/i;
export function resolveAsset(value, base) {
  if (
    !value ||
    /[${}<>\s]/.test(value) ||
    value.startsWith("data:") ||
    value.startsWith("#")
  )
    return null;
  let u;
  try {
    u = new URL(value, base);
  } catch {
    return null;
  }
  if (
    u.protocol !== "https:" ||
    !hosts.has(u.hostname) ||
    /^\/(?:api|v[123]|daemon|internal|socket\.io)(?:\/|$)/.test(u.pathname)
  )
    return null;
  if (
    u.hostname === "fonts.googleapis.com" &&
    !/^\/css(?:2)?$/.test(u.pathname)
  )
    return null;
  if (!extensions.test(u.pathname) && u.hostname !== "fonts.googleapis.com")
    return null;
  u.hash = "";
  return u.href;
}
export function sourcePath(url) {
  const u = new URL(url),
    suffix = u.search
      ? "__q_" +
        createHash("sha256").update(u.search).digest("hex").slice(0, 12)
      : "";
  const path = decodeURIComponent(u.pathname).replace(/^\/+/, ""),
    ext = posix.extname(path);
  if (
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((p) => p === ".." || p === ".")
  )
    throw Error("Unsafe captured asset path");
  const stem = ext ? path.slice(0, -ext.length) : path;
  return "files/" + u.hostname + "/" + stem + suffix + ext;
}
export function discoverResources(source, mime, base) {
  const urls = new Set();
  urls.dynamicImports = [];
  const add = (v, explicit = false) => {
    if (!explicit && v.includes("node_modules/")) return;
    const normalized = v.startsWith("assets/") ? "/" + v : v;
    const u = resolveAsset(normalized, base);
    if (u) urls.add(u);
  };
  if (/javascript|ecmascript/.test(mime) || /\.m?js(?:\?|$)/.test(base)) {
    const ast = ts.createSourceFile(
      base,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    if (ast.parseDiagnostics.length)
      throw Error("Published module does not parse: " + base);
    const walk = (n) => {
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) {
        if (n.moduleSpecifier && ts.isStringLiteralLike(n.moduleSpecifier))
          add(n.moduleSpecifier.text, true);
      }
      if (
        ts.isCallExpression(n) &&
        n.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const a = n.arguments[0];
        if (a && ts.isStringLiteralLike(a)) add(a.text, true);
        else urls.dynamicImports.push(n.getText(ast).slice(0, 500));
      }
      if (
        ts.isStringLiteralLike(n) &&
        /^(?:\.\.?\/|\/|assets\/|https:\/\/)/.test(n.text)
      )
        add(n.text);
      ts.forEachChild(n, walk);
    };
    walk(ast);
  } else if (/html/.test(mime)) {
    for (const m of source.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi))
      add(m[1]);
    for (const m of source.matchAll(/["'](\/assets\/[^"'<>\s]+)["']/g))
      add(m[1]);
  } else if (/css/.test(mime)) {
    for (const m of source.matchAll(/@import\s+["']([^"']+)["']/g)) add(m[1]);
    for (const m of source.matchAll(
      /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g,
    ))
      add((m[1] ?? m[2] ?? m[3]).trim());
  } else if (/json|manifest/.test(mime)) {
    const walk = (v) => {
      if (typeof v === "string") add(v);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(JSON.parse(source));
  }
  return urls;
}
export async function captureRelease({
  htmlFile,
  out,
  version = "1.21.40",
  concurrency = 6,
  maxFiles = 1800,
}) {
  const html = readFileSync(htmlFile, "utf8"),
    identity = JSON.parse(
      html.match(/id="raft-frontend-release-identity"[^>]*>([^<]+)/)?.[1] ??
        "null",
    );
  if (identity?.branch !== "release/v" + version)
    throw Error("Target release identity mismatch");
  mkdirSync(out, { recursive: true });
  const root = origin + "/index.html",
    progress = resolve(out, "capture-progress.json");
  const prior = existsSync(progress)
    ? JSON.parse(readFileSync(progress, "utf8"))
    : null;
  if (prior && prior.release.releaseId !== identity.releaseId)
    throw Error("Refuse to mix releases");
  const records = new Map((prior?.files ?? []).map((x) => [x.url, x])),
    queued = new Set(),
    queue = [],
    failures = [];
  const enqueue = (u) => {
    if (!queued.has(u)) {
      queued.add(u);
      queue.push(u);
    }
  };
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  const persist = () =>
    writeFileSync(
      progress,
      JSON.stringify(
        { release: identity, files: [...records.values()] },
        null,
        2,
      ) + "\n",
    );
  const ingest = (url, bytes, mime) => {
    const path = sourcePath(url);
    mkdirSync(dirname(resolve(out, path)), { recursive: true });
    writeFileSync(resolve(out, path), bytes);
    const text = /javascript|ecmascript|html|css|json|manifest/.test(mime)
      ? bytes.toString("utf8")
      : "";
    const edges = discoverResources(text, mime, url),
      record = {
        url,
        file: path,
        sha256: sha(bytes),
        bytes: bytes.length,
        mime,
        dependencies: [...edges],
        dynamicImports: edges.dynamicImports,
      };
    records.set(url, record);
    for (const dep of edges) enqueue(dep);
    persist();
    return record;
  };
  const entry = ingest(root, Buffer.from(html), "text/html");
  queued.add(root);
  for (const record of records.values()) {
    if (
      !existsSync(resolve(out, record.file)) ||
      sha(readFileSync(resolve(out, record.file))) !== record.sha256
    )
      throw Error("Corrupt capture " + record.file);
    const edges = discoverResources(
      readFileSync(resolve(out, record.file), "utf8"),
      record.mime,
      record.url,
    );
    record.dependencies = [...edges];
    record.dynamicImports = edges.dynamicImports;
    for (const dep of record.dependencies) enqueue(dep);
  }
  while (queue.length) {
    const batch = queue.splice(0, concurrency);
    if (queued.size > maxFiles)
      throw Error("Resource limit exceeded; inspect graph");
    await Promise.all(
      batch.map(async (url) => {
        if (records.has(url)) return;
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(25000),
            headers: {
              "User-Agent": "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36",
            },
          });
          if (!response.ok) throw Error("HTTP " + response.status);
          if (!hosts.has(new URL(response.url).hostname))
            throw Error("Unexpected redirect " + response.url);
          const mime = response.headers.get("content-type") ?? "",
            bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length > 50_000_000)
            throw Error("Unexpected oversized asset");
          if (url !== root && /text\/html/.test(mime))
            throw Error("Asset fell back to HTML");
          ingest(url, bytes, mime);
        } catch (e) {
          failures.push({ url, error: String(e) });
        }
      }),
    );
    process.stdout.write(
      JSON.stringify({
        captured: records.size,
        queued: queue.length,
        failed: failures.length,
      }) + "\n",
    );
  }
  const sorted = [...records.values()].sort((a, b) =>
    a.url.localeCompare(b.url),
  );
  const missing = sorted.flatMap((x) =>
    x.dependencies
      .filter((u) => !records.has(u))
      .map((url) => ({ from: x.url, url })),
  );
  const result = {
    kind: "complete official executable distribution capture, not authored TSX checkout",
    release: identity,
    entry: entry.url,
    entrySha256: entry.sha256,
    files: sorted,
    firstPartyModules: sorted.filter(
      (x) =>
        x.url.startsWith(origin) && /\.m?js$/.test(new URL(x.url).pathname),
    ).length,
    totalBytes: sorted.reduce((n, x) => n + x.bytes, 0),
    failed: failures,
    missingEdges: missing,
    nonliteralImports: sorted
      .filter((x) => x.dynamicImports.length)
      .map((x) => ({ url: x.url, expressions: x.dynamicImports })),
    staticClosureComplete: failures.length === 0 && missing.length === 0,
    semanticWholeReleaseReviewed: false,
  };
  writeFileSync(
    resolve(out, "release-lock.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  if (!result.staticClosureComplete)
    throw Error("Incomplete resource closure; inspect release-lock.json");
  return result;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [, , htmlFile, out] = process.argv;
  const r = await captureRelease({ htmlFile, out });
  console.log(
    JSON.stringify({
      release: r.release,
      files: r.files.length,
      modules: r.firstPartyModules,
      bytes: r.totalBytes,
      nonliteralImportFiles: r.nonliteralImports.length,
    }),
  );
}
