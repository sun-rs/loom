import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";

// Exact raster derivatives of the maintained brand SVG; no generated artwork.
const svg = readFileSync(
  new URL("../apps/web/public/rah-app-icon.svg", import.meta.url),
  "utf8",
);
const browser = await chromium.launch({
  headless: true,
  executablePath: await findChromeExecutable(),
});
try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>${svg}`,
    );
    await page.screenshot({
      path: new URL(
        `../apps/web/public/rah-app-icon-${size}.png`,
        import.meta.url,
      ).pathname,
      omitBackground: true,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
