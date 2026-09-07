import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "playwright";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
import { classifyFoundationBrowserRequest } from "./foundation-browser-request-policy.mjs";
import {
  verifyPreviewContent,
  verifyPreviewLifetime,
} from "./ui-profile-family-browser-scenarios.mjs";
import {
  snapshotUiEvidenceInputs,
  assertUiEvidenceInputSnapshot,
  uiContractEvidenceInputPaths,
} from "./ui-evidence-inputs.mjs";
const output = mkdtempSync(join(tmpdir(), "rah-agent-preview-"));
const options = { extraPaths: uiContractEvidenceInputPaths() };
const receipt = {
  output,
  inputs: snapshotUiEvidenceInputs(options),
  results: [],
};
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)),
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  {
    cwd: new URL("../apps/web", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
server.stdout.on("data", (data) => (logs += data));
server.stderr.on("data", (data) => (logs += data));
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw new Error(logs);
    try {
      if ((await fetch(`${origin}/test/ui-foundations.html`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, logs);

  for (const engine of process.env.RAH_UI_BROWSER
    ? [process.env.RAH_UI_BROWSER]
    : ["chrome", "firefox"]) {
    const browser = await (engine === "chrome" ? chromium : firefox).launch({
      headless: true,
      ...(engine === "chrome"
        ? { executablePath: await findChromeExecutable() }
        : {}),
    });
    try {
      const page = await browser.newPage();
      const errors = [],
        rejected = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.route("**/*", (route) => {
        const r = classifyFoundationBrowserRequest({
          harnessOrigin: origin,
          method: route.request().method(),
          url: route.request().url(),
        });
        if (r.decision !== "reject") return route.continue();
        rejected.push(r);
        return route.abort();
      });
      await page.goto(origin + "/test/ui-foundations.html", {
        waitUntil: "load",
      });
      await verifyPreviewContent(page, output, engine);
      await verifyPreviewLifetime(page);
      assert.deepEqual(errors, []);
      assert.deepEqual(rejected, []);
      receipt.results.push({ engine, status: "passed" });
    } finally {
      await browser.close();
    }
  }
  assertUiEvidenceInputSnapshot(receipt.inputs, options);
  writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt.results));
} finally {
  server.kill("SIGTERM");
  console.log(output);
}
