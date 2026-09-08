import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { chromium } from "playwright";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
import { comparisonConditions } from "./ui-bilateral-captures.mjs";

// This consumes real browser captures; it never fabricates an official page or
// reads an authenticated browser profile. Native responsive-mode PNGs and
// Playwright viewport PNGs share the same measured capture contract.
assert.ok(
  process.argv[2],
  "usage: node scripts/render-ui-bilateral-captures.mjs manifest.json [output]",
);
const manifestPath = resolve(process.argv[2]);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(manifest.schemaVersion, 1);
assert.ok(Array.isArray(manifest.pairs) && manifest.pairs.length);
const output = resolve(
  process.argv[3] ?? join(dirname(manifestPath), "comparison"),
);
await mkdir(output, { recursive: true });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const browser = await chromium.launch({
  executablePath: await findChromeExecutable(),
  headless: true,
});
const report = {
  schemaVersion: 1,
  kind: "bilateral-capture-human-review",
  renderedAt: new Date().toISOString(),
  manifestSha256: sha(await readFile(manifestPath)),
  results: [],
};
try {
  const page = await browser.newPage();
  const ids = new Set();
  for (const pair of manifest.pairs) {
    assert.match(pair.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(pair.id), "duplicate capture pair");
    ids.add(pair.id);
    const conditions = comparisonConditions(pair.official, pair.local);
    const images = {};
    for (const side of ["official", "local"]) {
      const capture = pair[side];
      assert.equal(
        capture.kind,
        side === "official" ? "official-live-capture" : "local-browser-capture",
      );
      assert.ok(
        capture.capturedAt &&
          capture.url &&
          capture.browser &&
          capture.sourceRevision,
      );
      const bytes = await readFile(
        resolve(dirname(manifestPath), capture.path),
      );
      assert.equal(sha(bytes), capture.sha256, `${side} screenshot changed`);
      assert.equal(
        bytes.subarray(0, 8).toString("hex"),
        "89504e470d0a1a0a",
        "PNG capture required",
      );
      const { width, height, dpr } = capture.environment;
      assert.equal(
        bytes.readUInt32BE(16),
        Math.round(width * dpr),
        `${side} screenshot width differs from evidence`,
      );
      assert.equal(
        bytes.readUInt32BE(20),
        Math.round(height * dpr),
        `${side} screenshot height differs from evidence`,
      );
      images[side] = `data:image/png;base64,${bytes.toString("base64")}`;
    }
    const rendered = await page.evaluate(
      async ({ images }) => {
        const load = (src) =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
          });
        const [a, b] = await Promise.all([
          load(images.official),
          load(images.local),
        ]);
        const canvas = document.createElement("canvas");
        canvas.width = a.width + b.width;
        canvas.height = Math.max(a.height, b.height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ddd";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(a, 0, 0);
        ctx.drawImage(b, a.width, 0);
        const paired = canvas.toDataURL("image/png");
        if (a.width !== b.width || a.height !== b.height)
          return { paired, diff: null };
        canvas.width = a.width;
        canvas.height = a.height;
        ctx.drawImage(a, 0, 0);
        const left = ctx.getImageData(0, 0, a.width, a.height);
        ctx.clearRect(0, 0, a.width, a.height);
        ctx.drawImage(b, 0, 0);
        const right = ctx.getImageData(0, 0, b.width, b.height);
        for (let i = 0; i < left.data.length; i += 4) {
          const delta = Math.max(
            ...[0, 1, 2, 3].map((offset) =>
              Math.abs(left.data[i + offset] - right.data[i + offset]),
            ),
          );
          left.data[i] = delta ? 255 : 245;
          left.data[i + 1] = delta ? 255 - delta : 245;
          left.data[i + 2] = delta ? 255 - delta : 245;
          left.data[i + 3] = 255;
        }
        ctx.putImageData(left, 0, 0);
        return { paired, diff: canvas.toDataURL("image/png") };
      },
      { images },
    );
    const files = {};
    for (const [key, data] of Object.entries(rendered))
      if (data) {
        files[key] = `${pair.id}-${key}.png`;
        await writeFile(
          join(output, files[key]),
          Buffer.from(data.split(",")[1], "base64"),
        );
      }
    report.results.push({
      id: pair.id,
      ...conditions,
      official: pair.official,
      local: pair.local,
      files,
      review: "pending",
      notes: pair.notes ?? [],
    });
  }
} finally {
  await browser.close();
}
await writeFile(
  join(output, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
await writeFile(
  join(output, "report.md"),
  "# 双边截图人眼复核\n\n左侧官网，右侧本地；差异图显示未经掩盖的像素差异，仅用于定位，绝不作为通过门禁。身份、文字、日期和数据量也会造成差异。截图不证明交互或后端结果，仍须逐项验收。\n\n" +
    report.results
      .map(
        (r) =>
          `## ${r.id}\n\n条件：${r.status}；差异：${r.differences.join(", ") || "无已登记条件差异"}；人眼复核：待进行。\n\n${r.notes.join("\n\n")}\n\n![官网与本地](${r.files.paired})\n\n${r.files.diff ? `![差异](${r.files.diff})` : "视口尺寸不等，不产生误导性差异图。"}\n`,
      )
      .join("\n"),
);
process.stdout.write(
  JSON.stringify({
    output,
    pairs: report.results.length,
    acceptance: "not asserted",
  }) + "\n",
);
