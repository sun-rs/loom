import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "playwright/test";

const output = mkdtempSync(join(tmpdir(), "rah-error-boundary-"));
const server = await createServer({
  configFile: false,
  root: resolve("apps/web"),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    react(),
    {
      name: "isolated-boundary-fixture",
      resolveId(id) {
        if (id === "/boundary-fixture.js") return "\0boundary-fixture";
      },
      load(id) {
        if (id !== "\0boundary-fixture") return;
        return `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { SurfaceErrorBoundary } from '/src/components/surface-error-boundary.tsx';
        import { SURFACE_ROOT_ERROR_OPTIONS } from '/src/components/surface-error-boundary-diagnostic.ts';
        function Content({ crash }) {
          if (crash) throw new Error('fixture render failure token=canary-secret');
          return React.createElement('p', null, 'Recovered content');
        }
        function App() {
          const [crash, setCrash] = useState(false), [key, setKey] = useState(0);
          return React.createElement('main', null,
            React.createElement('input', { 'aria-label': 'Sibling draft' }),
            React.createElement('button', { onClick: () => setCrash(true) }, 'Fail'),
            React.createElement('button', { onClick: () => setCrash(false) }, 'Repair'),
            React.createElement('button', { onClick: () => { setCrash(false); setKey(key + 1); } }, 'Navigate'),
            React.createElement(SurfaceErrorBoundary, { surface: 'Fixture', resetKey: String(key) },
              React.createElement(Content, { crash })));
        }
        createRoot(document.getElementById('root'), SURFACE_ROOT_ERROR_OPTIONS).render(React.createElement(App));
      `;
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url !== "/") return next();
          const html = await vite.transformIndexHtml(
            "/",
            '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/boundary-fixture.js"></script></body></html>',
          );
          response.setHeader("Content-Type", "text/html");
          response.end(html);
        });
      },
    },
  ],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const logs = [];
    page.on("console", (message) => logs.push(message.text()));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page
      .getByRole("textbox", { name: "Sibling draft" })
      .fill("Keep this draft");
    await page.getByRole("button", { name: "Fail", exact: true }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("fixture render failure");
    await expect(alert).not.toContainText("canary-secret");
    assert.ok(
      !logs.some((message) => message.includes("canary-secret")),
      "caught errors must not also leak through React's default logger",
    );
    await page.getByRole("button", { name: "重试此区域" }).click();
    await expect(alert).toBeVisible();
    await page.screenshot({ path: join(output, `failure-${width}.png`) });
    await page.getByRole("button", { name: "Repair", exact: true }).click();
    await expect(alert).toBeVisible();
    await page.getByRole("button", { name: "重试此区域" }).click();
    await expect(alert).toHaveCount(0);
    await expect(
      page.getByText("Recovered content", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Fail", exact: true }).click();
    await expect(alert).toBeVisible();
    await page.getByRole("button", { name: "Navigate", exact: true }).click();
    await expect(alert).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Sibling draft" }),
    ).toHaveValue("Keep this draft");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
    );
    await page.close();
  }
  console.log(
    `PASS real React error boundary, retry, navigation reset and sibling draft: ${output}`,
  );
} finally {
  await browser?.close();
  await server.close();
}
