import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
export async function verifyAttachments({
  browser,
  origin,
  client,
  workspace,
  head,
}) {
  const room = (
    await client.request("room.create", {
      workspaceId: workspace.workspaceId,
      kind: "channel",
      name: "FIXTURE attachments",
      slug: "fixture-attachments",
      basedOnControlRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: "attachments-room",
    })
  ).room;
  const results = [];
  for (const width of [1440, 390, 820]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      hasTouch: width !== 1440,
      isMobile: width !== 1440,
      acceptDownloads: true,
      serviceWorkers: "block",
    });
    try {
      const page = await context.newPage(),
        errors = [],
        external = [],
        posts = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (route) => {
        if (new URL(route.request().url()).origin !== origin) {
          external.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      await page.route("**/v3/client/computers/files/list", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            hostId: "fixture-host",
            label: "FIXTURE computer",
            rootId: "fixture-root",
            roots: [
              {
                rootId: "fixture-root",
                label: "FIXTURE root",
                absolutePath: "/FIXTURE",
              },
            ],
            path: "",
            absolutePath: "/FIXTURE",
            truncated: false,
            entries: [
              {
                name: "notes space.txt",
                path: "notes space.txt",
                absolutePath: "/FIXTURE/notes space.txt",
                isDirectory: false,
              },
            ],
          }),
        }),
      );
      await page.route("**/v3/client/messages/post", async (route) => {
        posts.push(route.request().postDataJSON());
        if (posts.length === 1) {
          await route.fetch();
          await route.abort();
        } else await route.continue();
      });
      await page.goto(origin + "/?room=" + room.roomId);
      const composer = page.getByTestId("chat-composer-shell"),
        input = composer.locator("textarea");
      await input.waitFor();
      await composer
        .getByRole("button", { name: "引用计算机文件或文件夹", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "引用计算机文件或文件夹",
      });
      await dialog.waitFor();
      await dialog
        .getByRole("button", { name: "notes space.txt", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "引用所选", exact: true })
        .click();
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="chat-composer-shell"] textarea')
          ?.value.includes('@"/FIXTURE/notes space.txt"'),
      );
      await input.fill(" ");
      await input.fill("");
      await page.waitForTimeout(200);
      const file = {
        name: "fixture-" + width + ".txt",
        mimeType: "text/plain",
        buffer: Buffer.from("exact attachment bytes " + width),
      };
      if (width !== 1440) {
        const chooserPromise = page.waitForEvent("filechooser");
        void chooserPromise.catch(() => {});
        await composer.getByTestId("loom-native-file-input").tap();
        const chooser = await chooserPromise;
        assert.equal(chooser.isMultiple(), true);
        await chooser.setFiles([]);
        assert.equal(
          await composer.getByTestId("loom-attachment-drafts").count(),
          0,
        );
        await composer
          .getByTestId("loom-native-file-input")
          .setInputFiles(file);
      } else {
        assert.equal(
          await composer.getByTestId("loom-native-file-input").count(),
          0,
        );
        await composer.evaluate(
          (el, file) => {
            const dt = new DataTransfer();
            dt.items.add(
              new File([file.body], file.name, { type: "text/plain" }),
            );
            el.querySelector("textarea").dispatchEvent(
              new DragEvent("drop", {
                bubbles: true,
                cancelable: true,
                dataTransfer: dt,
              }),
            );
          },
          { name: file.name, body: file.buffer.toString() },
        );
      }
      await composer.locator('[data-upload-status="ready"]').waitFor();
      const send = composer.getByTestId("composer-send");
      // Native component keeps its existing accessible send control.
      const submit = (await send.count())
        ? send
        : composer.locator('button[type="submit"]');
      await submit.click();
      await page.getByRole("button", { name: "核实发送", exact: true }).click();
      await composer
        .getByTestId("loom-attachment-drafts")
        .waitFor({ state: "detached" });
      assert.equal(posts.length, 2);
      assert.deepEqual(posts[0], posts[1]);
      assert.equal(posts[0].attachmentIds.length, 1);
      assert.equal(posts[0].body, "");
      await page.reload();
      await input.waitFor();
      const card = page
        .getByTestId("loom-message-attachments")
        .filter({ hasText: file.name });
      await card.waitFor();
      const downloadPromise = page.waitForEvent("download");
      await card.getByText(file.name, { exact: true }).click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), file.name);
      assert.deepEqual(await readFile(await download.path()), file.buffer);
      await page.screenshot({
        path: "/tmp/loom-attachments-" + width + ".png",
        animations: "disabled",
      });
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      results.push({
        width,
        referencePath: true,
        nativePicker: width !== 1440,
        desktopDrop: width === 1440,
        attachmentOnlySend: true,
        exactUnknownReplay: true,
        reloadDownloadExact: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
