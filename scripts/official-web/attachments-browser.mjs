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
      locale: "zh-CN",
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
      let releaseListing,
        listingStarted,
        holdListing = false,
        rejectListing = false;
      await page.route("**/v3/client/computers/files/list", async (route) => {
        const path = route.request().postDataJSON().path || "";
        if (holdListing) {
          await new Promise((resolve) => {
            releaseListing = resolve;
            listingStarted?.();
          });
          holdListing = false;
        }
        if (rejectListing) {
          rejectListing = false;
          return route.fulfill({
            status: 503,
            body: "FIXTURE listing failure",
          });
        }
        return route.fulfill({
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
            path,
            absolutePath: "/FIXTURE" + (path ? "/" + path : ""),
            truncated: false,
            entries: (path === "empty"
              ? []
              : path === "small"
                ? ["one.txt", "two.txt"]
                : [
                    "small",
                    "empty",
                    "notes space.txt",
                    ...Array.from(
                      { length: 30 },
                      (_, i) => "file-" + i + ".txt",
                    ),
                  ]
            ).map((name) => ({
              name,
              path: (path ? path + "/" : "") + name,
              absolutePath: "/FIXTURE/" + (path ? path + "/" : "") + name,
              isDirectory: name === "small" || name === "empty",
            })),
          }),
        });
      });
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
      await page.reload();
      await input.waitFor();
      await composer
        .getByRole("button", { name: "引用计算机文件或文件夹", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "引用文件或文件夹",
      });
      await dialog.waitFor();
      const hiddenToggle = dialog.getByRole("checkbox", {
        name: "显示隐藏文件",
      });
      assert.equal(
        await hiddenToggle.getAttribute("data-slot"),
        "checkbox",
        "file picker reuses the official Raft checkbox, including its focus styling",
      );
      assert.equal(await hiddenToggle.isChecked(), false);
      await page.screenshot({
        path: `/tmp/loom-checkbox-first-${width}.png`,
        animations: "disabled",
      });
      const hiddenRequest = page.waitForRequest(
        (request) =>
          request.url().endsWith("/computers/files/list") &&
          request.postDataJSON().includeHidden === true,
      );
      await dialog.getByText("显示隐藏文件", { exact: true }).click();
      await hiddenRequest;
      assert.equal(await hiddenToggle.isChecked(), true);
      await hiddenToggle.focus();
      await page.screenshot({
        path: `/tmp/loom-checkbox-checked-${width}.png`,
        animations: "disabled",
      });
      const visibleRequest = page.waitForRequest(
        (request) =>
          request.url().endsWith("/computers/files/list") &&
          request.postDataJSON().includeHidden === false,
      );
      await hiddenToggle.press("Space");
      await visibleRequest;
      assert.equal(await hiddenToggle.isChecked(), false);
      assert.equal(
        await composer.getByTestId("loom-native-file-input").count(),
        0,
        "composer only exposes Plus",
      );
      assert.equal(
        await dialog.getByTestId("loom-native-file-input").isDisabled(),
        true,
        "loopback defaults to same device",
      );
      assert.equal(
        await dialog
          .getByText("当前浏览 Loom 主机的授权目录", { exact: true })
          .count(),
        0,
      );
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await page.goto(origin + "/?fileDevice=remote&room=" + room.roomId);
      await composer
        .getByRole("button", { name: "引用计算机文件或文件夹", exact: true })
        .click();
      await dialog.getByTestId("loom-native-file-input").waitFor();
      assert.equal(
        await dialog.getByTestId("loom-native-file-input").isDisabled(),
        false,
      );

      await dialog
        .getByRole("button", { name: "small", exact: true })
        .waitFor();
      const geometry = () =>
        dialog.evaluate((el) => {
          const up = [...el.querySelectorAll("button")].find(
            (b) =>
              b.textContent.trim() === "上一级目录" ||
              b.getAttribute("aria-label") === "上一级目录",
          );
          const tree = up.closest("[data-testid='computer-file-tree']");
          const hidden = el.querySelector("[role=checkbox]");
          return {
            height: el.getBoundingClientRect().height,
            treeHeight: tree?.getBoundingClientRect().height,
            upFirst: tree?.querySelector("button") === up,
            hiddenBelow:
              !!tree &&
              hidden.getBoundingClientRect().top >=
                tree.getBoundingClientRect().bottom,
          };
        });
      const parentNode = await dialog
        .getByRole("button", { name: "上一级目录", exact: true })
        .elementHandle();
      holdListing = true;
      const listingPending = new Promise((resolve) => {
        listingStarted = resolve;
      });
      await dialog.getByRole("button", { name: "small", exact: true }).click();
      await listingPending;
      try {
        assert.equal(
          await dialog.locator("code").textContent(),
          "/FIXTURE",
          "pending navigation keeps the displayed path",
        );
        assert.equal(
          await dialog
            .getByRole("button", { name: "notes space.txt", exact: true })
            .count(),
          0,
          "pending navigation clears only file entries",
        );
        assert.equal(
          await dialog
            .getByRole("button", { name: "引用所选", exact: true })
            .isDisabled(),
          true,
          "stale directory cannot be referenced while loading",
        );
        assert.equal(
          await parentNode.evaluate((node) => node.isConnected),
          true,
          "parent row is never unmounted",
        );
      } finally {
        releaseListing();
      }
      await dialog
        .getByRole("button", { name: "one.txt", exact: true })
        .waitFor();
      await dialog
        .getByRole("button", { name: "上一级目录", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "small", exact: true })
        .waitFor();
      rejectListing = true;
      await dialog.getByRole("button", { name: "small", exact: true }).click();
      await dialog.getByRole("alert").waitFor();
      assert.equal(await dialog.locator("code").textContent(), "/FIXTURE");
      assert.equal(
        await dialog
          .getByRole("button", { name: "notes space.txt", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await dialog
          .getByRole("button", { name: "引用所选", exact: true })
          .isDisabled(),
        true,
      );
      await dialog.getByRole("button", { name: "重试", exact: true }).click();
      await dialog
        .getByRole("button", { name: "one.txt", exact: true })
        .waitFor();
      await dialog
        .getByRole("button", { name: "上一级目录", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "small", exact: true })
        .waitFor();
      if (width === 1440) {
        await dialog
          .getByRole("button", { name: "small", exact: true })
          .click();
        await dialog
          .getByRole("button", { name: "one.txt", exact: true })
          .waitFor();
        holdListing = true;
        const parentPending = new Promise((resolve) => {
          listingStarted = resolve;
        });
        await dialog
          .getByRole("button", { name: "上一级目录", exact: true })
          .click();
        await parentPending;
        try {
          assert.equal(
            await dialog.locator("code").textContent(),
            "/FIXTURE/small",
          );
          assert.equal(
            await dialog
              .getByRole("button", { name: "one.txt", exact: true })
              .count(),
            0,
          );
          await dialog
            .getByText("目录读取超时，请重试。", { exact: false })
            .waitFor({ timeout: 15000 });
          assert.equal(
            await dialog
              .getByRole("button", { name: "引用所选", exact: true })
              .isDisabled(),
            true,
          );
        } finally {
          releaseListing();
        }
        await dialog.getByRole("button", { name: "重试", exact: true }).click();
        await dialog
          .getByRole("button", { name: "small", exact: true })
          .waitFor();
      }
      const footerGap = await dialog.evaluate((el) => {
        const toggle = el
          .querySelector("[role=checkbox]")
          .closest("label")
          .getBoundingClientRect();
        const footer = el
          .querySelector('[data-slot="dialog-footer"]')
          .getBoundingClientRect();
        return footer.top - toggle.bottom;
      });
      assert.ok(
        footerGap <= 28,
        "footer follows controls without excessive blank space: " + footerGap,
      );
      const parentBefore = await dialog
        .getByRole("button", { name: "上一级目录", exact: true })
        .boundingBox();
      await dialog.getByTestId("computer-file-entries").evaluate((el) => {
        el.scrollTop = 80;
      });
      assert.deepEqual(
        await dialog
          .getByRole("button", { name: "上一级目录", exact: true })
          .boundingBox(),
        parentBefore,
        "file scroll never scrolls parent row",
      );
      await dialog.getByTestId("computer-file-entries").evaluate((el) => {
        el.scrollTop = 0;
      });
      const initial = await geometry();
      assert.equal(
        initial.upFirst,
        true,
        "parent navigation is the first file-tree row",
      );
      assert.equal(
        initial.hiddenBelow,
        true,
        "hidden toggle is below the file-tree module",
      );
      assert.ok(initial.treeHeight >= 256, "file tree reserves browsing space");
      assert.equal(
        await dialog
          .getByRole("button", { name: "上一级目录", exact: true })
          .isDisabled(),
        true,
      );
      for (const name of ["small", "empty"]) {
        await dialog.getByRole("button", { name, exact: true }).click();
        await dialog
          .locator("code")
          .filter({ hasText: "/FIXTURE/" + name })
          .waitFor();
        if (name === "empty")
          await dialog.getByText("此目录为空", { exact: true }).waitFor();
        const current = await geometry();
        assert.equal(
          current.height,
          initial.height,
          "dialog height remains stable in " + name,
        );
        assert.equal(
          current.treeHeight,
          initial.treeHeight,
          "tree height remains stable in " + name,
        );
        await dialog
          .getByRole("button", { name: "上一级目录", exact: true })
          .click();
        await dialog
          .getByRole("button", { name: "small", exact: true })
          .waitFor();
      }
      await page.screenshot({ path: "/tmp/loom-file-tree-" + width + ".png" });

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
      await composer
        .getByRole("button", { name: "引用计算机文件或文件夹", exact: true })
        .click();
      {
        const chooserPromise = page.waitForEvent("filechooser");
        void chooserPromise.catch(() => {});
        if (width === 1440)
          await dialog.getByTestId("loom-native-file-input").click();
        else await dialog.getByTestId("loom-native-file-input").tap();
        const chooser = await chooserPromise;
        assert.equal(chooser.isMultiple(), true);
        await chooser.setFiles([]);
        assert.equal(
          await composer.getByTestId("loom-attachment-drafts").count(),
          0,
        );
      }
      if (width !== 1440) {
        await dialog.getByTestId("loom-native-file-input").setInputFiles(file);
      } else {
        assert.equal(
          await dialog.getByTestId("loom-native-file-input").count(),
          1,
        );
        await dialog.getByRole("button", { name: "取消", exact: true }).click();
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
      if (width === 390) {
        await composer.locator("textarea").blur();
        assert.equal(
          await composer.getByTestId("loom-attachment-drafts").isVisible(),
          true,
        );
        assert.equal(
          await composer
            .locator('[data-slot="composer"]')
            .evaluate((el) => getComputedStyle(el).display),
          "flex",
          "attachment-only draft stays expanded without focus",
        );
      }
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
      await card.getByText(file.name, { exact: true }).click();
      const preview = page.getByTestId(
        "attachment-preview-browser-find-scroll",
      );
      await preview.waitFor();
      await preview
        .locator("[data-anchor-line]")
        .filter({ hasText: "exact attachment bytes " + width })
        .waitFor();
      const downloadPromise = page.waitForEvent("download");
      await preview.getByRole("button", { name: "下载", exact: true }).click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), file.name);
      assert.deepEqual(await readFile(await download.path()), file.buffer);
      await preview.getByRole("button", { name: "关闭", exact: true }).click();
      await page.screenshot({
        path: "/tmp/loom-attachments-" + width + ".png",
        animations: "disabled",
      });
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      results.push({
        width,
        referencePath: true,
        raftCheckboxAfterRefresh: true,
        hiddenFilesLabelAndKeyboard: true,
        nativePicker: true,
        stableTreeLayout: true,
        pendingNavigationKeepsParentOnly: true,
        failedNavigationRetainsNavigationAndRetries: true,
        compactFooter: true,
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
