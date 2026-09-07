import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { readyComposer } from "./composer-drop-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
import {
  snapshotUiEvidenceInputs,
  assertUiEvidenceInputSnapshot,
  uiContractEvidenceInputPaths,
} from "./ui-evidence-inputs.mjs";
import {
  pdfFixture,
  wavFixture,
  videoFixture,
} from "./media-preview-fixtures.mjs";
import { LocalWorkbenchGateway } from "../packages/daemon/src/local-workbench-gateway.ts";
const output = mkdtempSync(join(tmpdir(), "rah-media-preview-"));
const producer = await chromium.launch({
  headless: true,
  executablePath: await findChromeExecutable(),
});
const mediaPage = await producer.newPage();
const video = await videoFixture(mediaPage);
const png = Buffer.from(
  await mediaPage.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 40;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffda33";
    context.fillRect(0, 0, 80, 40);
    return canvas.toDataURL("image/png").split(",")[1];
  }),
  "base64",
);
await producer.close();
const options = {
  extraPaths: [
    ...uiContractEvidenceInputPaths(),
    "apps/web/pdf-assets-plugin.ts",
  ],
};
const receipt = {
  output,
  inputs: snapshotUiEvidenceInputs(options),
  results: [],
};
try {
  for (const engine of process.env.RAH_UI_BROWSER
    ? [process.env.RAH_UI_BROWSER]
    : ["chrome", "firefox"]) {
    const backend = await startShellFixture();
    const gateway = new LocalWorkbenchGateway({
      accessToken: "isolated-media-fixture",
      sessionToken: "fixture-media-session-".padEnd(43, "x"),
      daemonOrigin: backend.origin,
      port: 0,
      staticDirectory: join(process.cwd(), "apps/web/dist-workbench"),
    });
    await gateway.start().catch(async (error) => {
      await backend.close();
      throw error;
    });
    const fixture = {
      origin: gateway.origin,
      close: async () => {
        await gateway.stop();
        await backend.close();
      },
    };
    const browser = await (engine === "chrome" ? chromium : firefox).launch({
      headless: true,
      ...(engine === "chrome"
        ? { executablePath: await findChromeExecutable() }
        : {}),
    });
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(15000);
      await page.addInitScript(() =>
        localStorage.setItem("rah:web-push-desired:v1", "disabled"),
      );
      await page.addInitScript(() => {
        window.__previewUrls = new Set();
        const create = URL.createObjectURL.bind(URL),
          revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = (blob) => {
          const url = create(blob);
          window.__previewUrls.add(url);
          return url;
        };
        URL.revokeObjectURL = (url) => {
          window.__previewUrls.delete(url);
          return revoke(url);
        };
      });
      await page.goto(fixture.origin);
      const post = async (path, data) => {
        const r = await page.request.post(
          fixture.origin + "/v3/client/" + path,
          { data, headers: { origin: fixture.origin } },
        );
        assert.equal(r.status(), 200, await r.text());
        return r.json();
      };
      const workspace = (await post("workspaces/list", {})).workspaces[0];
      const head = (
        await post("rooms/sync", {
          roomId: workspace.controlRoomId,
          consumerId: "file-gate",
          bootstrap: "latest",
          limit: 1,
        })
      ).latestRoomSeq;
      const room = (
        await post("rooms/create", {
          workspaceId: workspace.workspaceId,
          kind: "channel",
          name: "File types fixture",
          slug: "file-types-fixture",
          visibility: "private",
          basedOnControlRoomSeq: head,
          idempotencyKey: crypto.randomUUID(),
        })
      ).room;
      await page.goto(fixture.origin + "/?room=" + room.roomId);
      const form = await readyComposer(page, "消息输入框");
      const cases = [
        { name: "sample.png", mime: "image/png", bytes: png, kind: "image" },
        {
          name: "sample.pdf",
          mime: "application/pdf",
          bytes: pdfFixture(),
          kind: "pdf",
        },
        {
          name: "sample.wav",
          mime: "audio/wav",
          bytes: wavFixture(),
          kind: "audio",
        },
        {
          name: "sample.webm",
          mime: "video/webm",
          bytes: video,
          kind: "video",
        },
      ];
      cases.push(
        {
          name: "broken.pdf",
          mime: "application/pdf",
          bytes: Buffer.from("invalid pdf fixture"),
          kind: "invalid-pdf",
        },
        {
          name: "broken.wav",
          mime: "audio/wav",
          bytes: Buffer.from("invalid audio fixture"),
          kind: "invalid-audio",
        },
        {
          name: "broken.webm",
          mime: "video/webm",
          bytes: Buffer.from("invalid video fixture"),
          kind: "invalid-video",
        },
      );
      for (const item of cases) {
        await form.getByLabel("选择附件", { exact: true }).setInputFiles({
          name: item.name,
          mimeType: item.mime,
          buffer: item.bytes,
        });
        await form.getByText("已上传", { exact: true }).waitFor();
        await form.getByRole("button", { name: "发送", exact: true }).click();
        await page
          .locator(".rah-message-files .rah-file-card")
          .filter({ hasText: item.name })
          .waitFor();
      }
      for (const width of [1440, 390]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 900,
        });
        await page.reload();
        for (const item of cases) {
          const card = page
            .locator(".rah-message-files .rah-file-card")
            .filter({ hasText: item.name });
          const beforeUrls = await page.evaluate(() =>
            Array.from(window.__previewUrls),
          );
          await card.locator(".rah-file-open").click();
          const dialog = page.getByRole("dialog", {
            name: "预览 " + item.name,
            exact: true,
          });
          if (item.kind === "pdf") {
            const canvas = dialog.locator('canvas[data-pdf-rendered="true"]');
            await canvas.waitFor();
            assert.ok(
              await canvas.evaluate((el) => {
                const pixels = el
                  .getContext("2d")
                  .getImageData(0, 0, el.width, el.height).data;
                let ink = 0;
                for (let i = 0; i < pixels.length; i += 4)
                  if (
                    pixels[i] < 100 &&
                    pixels[i + 1] < 100 &&
                    pixels[i + 2] < 100 &&
                    pixels[i + 3] > 0
                  )
                    ink++;
                return ink > 100;
              }),
              "PDF must paint actual text, not an empty frame/canvas",
            );
            assert.equal(
              await dialog
                .locator("form.rah-pdf-controls")
                .evaluate((el) => getComputedStyle(el).display),
              "flex",
              "PDF toolbar must not inherit vertical form layout",
            );
            const fitWidth = await canvas.evaluate(
              (el) => el.getBoundingClientRect().width,
            );
            const pageInput = dialog.getByRole("textbox", { name: "PDF 页码" });
            for (const invalid of ["0", "3", "1.1", ""]) {
              await pageInput.fill(invalid);
              await pageInput.press("Enter");
              await dialog.getByRole("alert").waitFor();
              assert.equal(
                await canvas.getAttribute("aria-label"),
                "sample.pdf 第 1 页",
              );
            }
            await pageInput.fill("2");
            await pageInput.press("Enter");
            await dialog
              .locator(
                'canvas[data-pdf-rendered="true"][aria-label="sample.pdf 第 2 页"]',
              )
              .waitFor();
            assert.equal(
              await dialog
                .getByRole("button", { name: "下一页", exact: true })
                .isDisabled(),
              true,
            );
            await dialog
              .getByRole("button", { name: "上一页", exact: true })
              .click();
            await dialog
              .locator(
                'canvas[data-pdf-rendered="true"][aria-label="sample.pdf 第 1 页"]',
              )
              .waitFor();
            for (let i = 0; i < 5; i++)
              await dialog
                .getByRole("button", { name: "放大 PDF", exact: true })
                .click();
            await canvas.waitFor();
            assert.ok(
              await canvas.evaluate((el) => el.width * el.height <= 4_000_000),
            );
            assert.ok(
              (await canvas.evaluate(
                (el) => el.getBoundingClientRect().width,
              )) >
                fitWidth * 1.5,
            );
            assert.ok(
              await dialog
                .locator(".rah-pdf-scroll")
                .evaluate((el) => el.scrollWidth > el.clientWidth),
            );
            await page.screenshot({
              path: join(output, `${engine}-${width}-pdf-zoom.png`),
            });
            await dialog
              .getByRole("button", { name: "适合宽度", exact: true })
              .click();
            await canvas.waitFor();
            assert.ok(
              Math.abs(
                (await canvas.evaluate(
                  (el) => el.getBoundingClientRect().width,
                )) - fitWidth,
              ) < 2,
            );
            assert.equal(await dialog.getByRole("alert").count(), 0);
            const firstPage = await canvas.evaluate((el) => el.toDataURL());
            await dialog
              .getByRole("button", { name: "下一页", exact: true })
              .click();
            await dialog
              .locator(
                'canvas[data-pdf-rendered="true"][aria-label="sample.pdf 第 2 页"]',
              )
              .waitFor();
            assert.notEqual(
              await dialog.locator("canvas").evaluate((el) => el.toDataURL()),
              firstPage,
            );
            await dialog
              .getByRole("button", { name: "上一页", exact: true })
              .click();
            await dialog
              .locator(
                'canvas[data-pdf-rendered="true"][aria-label="sample.pdf 第 1 页"]',
              )
              .waitFor();
          } else if (item.kind === "image") {
            await dialog.locator("img").waitFor();
            await page.waitForFunction(
              () =>
                document.querySelector('[role="dialog"] img')?.naturalWidth ===
                80,
            );
          } else if (item.kind.startsWith("invalid-")) {
            await dialog.getByRole("alert").waitFor();
          } else {
            const media = dialog.locator(item.kind);
            await media.waitFor();
            await page.waitForFunction((kind) => {
              const element = document.querySelector(`[role="dialog"] ${kind}`);
              return element && element.readyState >= 1 && element.duration > 0;
            }, item.kind);
            assert.equal(await media.evaluate((el) => el.autoplay), false);
            assert.equal(await media.evaluate((el) => el.controls), true);
          }
          const previewUrls = await page.evaluate(
            (before) =>
              Array.from(window.__previewUrls).filter(
                (url) => !before.includes(url),
              ),
            beforeUrls,
          );
          assert.equal(previewUrls.length, 1);
          const downloading = page.waitForEvent("download");
          await dialog
            .getByRole("button", { name: "下载", exact: true })
            .click();
          const downloaded = await downloading;
          assert.equal(await downloaded.failure(), null);
          assert.deepEqual(readFileSync(await downloaded.path()), item.bytes);
          await page.screenshot({
            path: join(output, `${engine}-${width}-${item.name}.png`),
          });
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "hidden" });
          assert.equal(
            await page.evaluate(
              (url) => window.__previewUrls.has(url),
              previewUrls[0],
            ),
            false,
          );
          assert.equal(
            await card
              .locator(".rah-file-open")
              .evaluate((el) => document.activeElement === el),
            true,
          );
          receipt.results.push({
            engine,
            width,
            kind: item.kind,
            filename: item.name,
            status: "passed",
          });
        }
      }
    } catch (error) {
      const page = browser.contexts()[0]?.pages()[0];
      if (page) {
        receipt.failureBody = await page.locator("body").innerText();
        await page.screenshot({ path: join(output, `${engine}-failure.png`) });
      }
      throw error;
    } finally {
      await browser.close();
      await fixture.close();
    }
  }
  assertUiEvidenceInputSnapshot(receipt.inputs, options);
} catch (error) {
  receipt.error = String(error);
  throw error;
} finally {
  writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt.results));
  console.log(output);
}
