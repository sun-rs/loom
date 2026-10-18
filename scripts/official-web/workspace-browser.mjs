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
    await page.getByRole("button", { name: "展开 src", exact: true }).click();
    await page
      .getByRole("button", { name: "打开 demo.md", exact: true })
      .click();
    await page
      .getByTestId("workspace-preview")
      .getByRole("heading", { name: "After", exact: true })
      .waitFor();
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
    result.push({
      width,
      initialResourceCount: initialResources.length,
      initialEncodedBytes: initialResources.reduce(
        (sum, r) => sum + r.encodedBodySize,
        0,
      ),
      workspaceChunkAbsentBeforeOpen: true,
      operations: requests.map((r) => ({
        operation: r.operation,
        path: r.path,
      })),
    });
    await page.close();
  }
  return result;
}
