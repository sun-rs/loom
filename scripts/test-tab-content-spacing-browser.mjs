import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";

const server = await createServer({
  root: new URL("../apps/web", import.meta.url).pathname,
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      for (const width of [1440, 390]) {
        const page = await browser.newPage({
          viewport: { width, height: 844 },
          isMobile: width === 390,
          hasTouch: width === 390,
        });
        await page.goto(
          server.resolvedUrls.local[0] + "test/ui-foundations.html",
        );
        await page.locator(".rah-agent-detail-tabs .tab").first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        const tabs = await page
          .locator(".rah-panel-tabs .tab")
          .evaluateAll((es) =>
            es.map((e) => {
              const range = document.createRange();
              range.selectNodeContents(e.lastChild);
              const text = range.getBoundingClientRect();
              const box = e.getBoundingClientRect();
              const icon = e.querySelector("svg").getBoundingClientRect();
              return {
                label: e.textContent,
                left: icon.left - box.left,
                right: box.right - text.right,
                gap: text.left - icon.right,
              };
            }),
          );
        for (const tab of tabs) {
          assert.ok(Math.abs(tab.left - 16) < 0.1, JSON.stringify(tab));
          assert.ok(Math.abs(tab.right - 16) < 0.1, JSON.stringify(tab));
          assert.ok(Math.abs(tab.gap - 6) < 0.1, JSON.stringify(tab));
        }
        const workspace = page.getByRole("tab", {
          name: "工作区",
          exact: true,
        });
        await workspace.focus();
        await workspace.press("Enter");
        assert.equal(await workspace.getAttribute("aria-selected"), "true");
        await page.screenshot({
          path: `/tmp/rah-tab-spacing-${engine.name()}-${width}.png`,
        });
        await page.goto(
          server.resolvedUrls.local[0] + "test/message-markdown-stability.html",
        );
        const mention = page.locator(".rah-rich-self-reference").first();
        await mention.waitFor();
        const references = page.locator(".rah-rich-reference");
        for (const reference of await references.all()) {
          const geometry = await reference.evaluate((e) => ({
            display: getComputedStyle(e).display,
            align: getComputedStyle(e).verticalAlign,
            label: e.querySelector(".rah-reference-label") !== null,
          }));
          assert.deepEqual(
            geometry,
            { display: "inline-flex", align: "baseline", label: true },
            await reference.textContent(),
          );
        }
        const style = await mention.evaluate((e) => {
          const s = getComputedStyle(e);
          return {
            display: s.display,
            verticalAlign: s.verticalAlign,
            ratio:
              parseFloat(s.fontSize) /
              parseFloat(getComputedStyle(e.parentElement).fontSize),
            leading: parseFloat(s.lineHeight) / parseFloat(s.fontSize),
            border: s.borderTopWidth,
            padding: [s.paddingLeft, s.paddingRight],
          };
        });
        for (const baselineTarget of await references.all()) {
          for (const size of [14, 16, 18, 20]) {
            for (const tag of ["span", "button"]) {
              const baseline = await baselineTarget.evaluate(
                (e, { size, tag }) => {
                  const line = document.createElement("p");
                  line.style.cssText = `font-family:${getComputedStyle(e).fontFamily};font-size:${size}px;line-height:1.5`;
                  const copy = document.createElement(tag);
                  copy.className = e.className;
                  copy.append(
                    ...Array.from(e.childNodes, (node) => node.cloneNode(true)),
                  );
                  line.append("正文 ", copy, " 星期四。");
                  document.body.append(line);
                  const probe = () => {
                    const p = document.createElement("span");
                    p.style.cssText =
                      "display:inline-block;width:0;height:0;padding:0;border:0;vertical-align:baseline";
                    return p;
                  };
                  const inner = probe(),
                    outer = probe();
                  (copy.querySelector(".rah-reference-label") ?? copy).append(
                    inner,
                  );
                  copy.after(outer);
                  const delta =
                    inner.getBoundingClientRect().top -
                    outer.getBoundingClientRect().top;
                  line.remove();
                  return delta;
                },
                { size, tag },
              );
              assert.ok(
                Math.abs(baseline) < 0.5,
                `text baseline offset: ${baseline}px`,
              );
            }
          }
        }
        assert.equal(style.display, "inline-flex");
        assert.equal(style.verticalAlign, "baseline");
        assert.equal(style.ratio, 0.875);
        assert.ok(Math.abs(style.leading - 1.3) < 0.01);
        assert.equal(style.border, "1px");
        assert.deepEqual(style.padding, ["4px", "4px"]);
        await mention.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `/tmp/rah-mention-alignment-${engine.name()}-${width}.png`,
        });
        await mention.evaluate((e) => {
          const examples = document.createElement("section");
          examples.id = "baseline-examples";
          examples.style.cssText =
            "position:fixed;inset:0;z-index:9999;background:white;padding:24px;overflow:auto";
          for (const size of [14, 16, 18, 20]) {
            const line = document.createElement("p");
            line.style.cssText = `font-family:${getComputedStyle(e).fontFamily};font-size:${size}px;line-height:1.5;margin:16px 0`;
            line.append(
              `${size}px 正文 `,
              e.cloneNode(true),
              " 星期四。Hello, world.",
            );
            examples.append(line);
          }
          const long = e.cloneNode(true);
          long.style.maxWidth = "140px";
          long.querySelector(".rah-reference-label").textContent =
            "@很长的用户名称 Long Display Name";
          examples.append(long);
          document.body.append(examples);
        });
        const long = page.locator(
          "#baseline-examples > .rah-rich-self-reference",
        );
        assert.ok((await long.boundingBox()).width <= 140);
        assert.equal(
          await long
            .locator(".rah-reference-label")
            .evaluate((e) => getComputedStyle(e).textOverflow),
          "ellipsis",
        );
        await page.screenshot({
          path: `/tmp/rah-baseline-examples-${engine.name()}-${width}.png`,
        });
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
  console.log(
    "Tab padding and intentional mention baseline alignment passed in Chromium/WebKit, desktop/mobile.",
  );
} finally {
  await server.close();
}
