import { createPdfFixture } from "./pdf-fixture.mjs";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
export async function verifyWorkspace({ browser, origin, client, channel }) {
  const root = channel.channelWorkspace.primaryDirectory;
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/demo.md"), "# Before\n");
  const git = (...args) => execFileSync("git", args, { cwd: root });
  git("init", "-q");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "base",
  );
  writeFileSync(join(root, "src/demo.md"), "# After\n");
  writeFileSync(
    join(root, "report.html"),
    "<h1>Workspace HTML</h1><script>parent.document.body.dataset.escaped='yes'</script>",
  );
  writeFileSync(join(root, "report.pdf"), createPdfFixture());
  writeFileSync(join(root, "separator.md"), "# Separator regression\n\n---\n");
  writeFileSync(
    join(root, "long.txt"),
    Array.from({ length: 4100 }, (_, i) => "line-" + i).join("\n"),
  );
  const result = [];
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const requests = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/channels/workspace/read"))
        requests.push(r.postDataJSON());
    });
    await page.goto(`${origin}/?room=${channel.roomId}`);
    // Use the actual route shape from the chat row if the initial route opens the list.
    const row = page.getByRole("button", { name: channel.name, exact: true });
    if (await row.isVisible()) await row.click();
    await page.getByTestId("panel-tab-chat").waitFor();
    assert.equal(requests.length, 0);
    const initialResources = await page.evaluate(() =>
      performance.getEntriesByType("resource").map((r) => ({
        name: r.name,
        encodedBodySize: r.encodedBodySize,
        transferSize: r.transferSize,
      })),
    );
    assert.equal(
      initialResources.some((r) => r.name.includes("ChannelWorkspacePanel-")),
      false,
    );
    await page.getByTestId("panel-tab-workspace").click({ timeout: 5000 });
    const controls = [];
    for (const name of ["刷新", "已隐藏隐藏文件"]) {
      const control = page
        .getByTestId("channel-workspace")
        .getByRole("button", { name, exact: true });
      const hit = await control.evaluate((el) => {
        const r = el.getBoundingClientRect(),
          top = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2,
          );
        return {
          width: r.width,
          height: r.height,
          clickable: top === el || el.contains(top),
        };
      });
      assert.equal(hit.width, 32);
      assert.equal(hit.height, 32);
      assert.ok(hit.clickable);
      controls.push({ name, ...hit });
    }
    await page.getByRole("button", { name: "展开 src", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "收起 src", exact: true })
        .getAttribute("aria-expanded"),
      "true",
    );

    await page
      .getByRole("button", { name: "打开 demo.md", exact: true })
      .click();
    await page
      .getByTestId("workspace-preview")
      .getByRole("heading", { name: "After", exact: true })
      .waitFor();
    if (width === 390) {
      const back = page.getByRole("button", {
        name: "返回文件列表",
        exact: true,
      });
      const hit = await back.evaluate((el) => {
        const r = el.getBoundingClientRect(),
          top = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2,
          );
        return {
          width: r.width,
          height: r.height,
          clickable: top === el || el.contains(top),
          icon: el.querySelector("svg")?.getAttribute("width"),
        };
      });
      assert.deepEqual(hit, {
        width: 32,
        height: 32,
        clickable: true,
        icon: "18",
      });
    }
    await page.getByTestId("workspace-file-view-raw").click();
    await page
      .getByTestId("workspace-preview")
      .getByText("# After", { exact: true })
      .waitFor();
    assert.equal(requests.filter((r) => r.operation === "read").length, 1);
    assert.equal(requests.filter((r) => r.operation === "diff").length, 0);
    if (width === 390)
      await page
        .getByRole("button", { name: "返回文件列表", exact: true })
        .click();
    await page.getByText("Git 变更", { exact: true }).click();
    await page
      .getByRole("button", { name: "查看差异 src/demo.md", exact: true })
      .click();
    await page
      .getByTestId("workspace-preview")
      .getByText("+# After", { exact: false })
      .waitFor();
    assert.equal(requests.filter((r) => r.operation === "diff").length, 1);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    if (process.env.LOOM_WORKSPACE_SCREENSHOTS)
      await page.screenshot({
        path: `${process.env.LOOM_WORKSPACE_SCREENSHOTS}/workspace-${width}.png`,
      });
    if (width === 390)
      await page
        .getByRole("button", { name: "返回文件列表", exact: true })
        .click();
    await page
      .getByRole("button", { name: "查看差异 long.txt", exact: true })
      .click();
    await page.getByRole("button", { name: "显示更多", exact: true }).waitFor();
    assert.equal(
      await page
        .getByTestId("workspace-preview")
        .getByText("+line-4099", { exact: false })
        .count(),
      0,
    );
    await page.getByRole("button", { name: "显示更多", exact: true }).click();
    await page
      .getByTestId("workspace-preview")
      .getByText("+line-4099", { exact: false })
      .waitFor();
    if (width === 390)
      await page
        .getByRole("button", { name: "返回文件列表", exact: true })
        .click();
    await page.getByText("文件", { exact: true }).click();
    for (const filename of ["report.html", "report.pdf"]) {
      await page
        .getByRole("button", { name: `打开 ${filename}`, exact: true })
        .click();
      await page
        .getByRole("button", { name: "打开预览", exact: true })
        .waitFor();
      if (filename.endsWith("html"))
        assert.match(
          await page.getByTestId("workspace-preview").innerText(),
          /<h1>Workspace HTML/,
        );
      await page.getByRole("button", { name: "打开预览", exact: true }).click();
      const frame = page.locator("iframe").last();
      await frame.waitFor();
      if (filename.endsWith("html")) {
        assert.ok(
          new URL(await frame.getAttribute("src"), origin).searchParams.get(
            "acBridgeNonce",
          ),
          "Native HTML bridge must receive absolute URL and nonce",
        );
        await page
          .locator(
            '[data-message-affordance="attachment-preview-external-links-loading"]',
          )
          .waitFor({ state: "hidden" });
        assert.equal(await frame.getAttribute("sandbox"), "allow-scripts");
        await page
          .frameLocator("iframe")
          .last()
          .getByRole("heading", { name: "Workspace HTML" })
          .waitFor();
        assert.equal(
          await page.evaluate(() => document.body.dataset.escaped),
          undefined,
        );
      } else {
        const url = await frame.getAttribute("src");
        assert.notEqual(new URL(url).origin, origin);
        const response = await page.request.get(url);
        assert.equal(response.status(), 200);
        assert.equal(response.headers()["content-type"], "application/pdf");
      }
      await page.keyboard.press("Escape");
      await frame.waitFor({ state: "detached" });
      if (width === 390)
        await page
          .getByRole("button", { name: "返回文件列表", exact: true })
          .click();
    }
    await page
      .getByRole("button", { name: "打开 separator.md", exact: true })
      .click();
    await page
      .getByTestId("workspace-preview")
      .locator('[data-slot="separator"],hr')
      .first()
      .waitFor();
    result.push({
      markdownSeparatorRendered: true,
      width,
      initialResourceCount: initialResources.length,
      initialEncodedBytes: initialResources.reduce(
        (sum, r) => sum + r.encodedBodySize,
        0,
      ),
      workspaceChunkAbsentBeforeOpen: true,
      nativeHeaderControls: controls,
      accessibleDirectoryExpansion: true,
      operations: requests.map((r) => ({
        operation: r.operation,
        path: r.path,
      })),
    });
    await page.close();
  }
  return result;
}
