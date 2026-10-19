import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
export async function verifyMobileJourney({ browser, origin, channel }) {
  writeFileSync(
    join(channel.channelWorkspace.primaryDirectory, "journey.md"),
    "# FIXTURE journey file\n",
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(`${origin}/?room=${channel.roomId}`);
    const row = page.getByRole("button", { name: channel.name, exact: true });
    if (await row.isVisible()) await row.click();
    const composer = page
      .getByTestId("chat-composer-shell")
      .getByTestId("composer-textarea");
    await composer.fill("FIXTURE mobile continuous journey");
    await composer.press("Enter");
    const posted = page.getByText("FIXTURE mobile continuous journey", {
      exact: true,
    });
    await posted.waitFor();
    await composer.fill("FIXTURE preserved mobile draft");
    await posted.tap();
    const thread = page.getByTestId("thread-side-column");
    await thread.getByTestId("thread-panel-parent").waitFor();
    await thread.getByTestId("composer-textarea").fill("FIXTURE thread reply");
    await thread.getByTestId("composer-textarea").press("Enter");
    await thread.getByText("FIXTURE thread reply", { exact: true }).waitFor();
    await thread.getByTestId("thread-mobile-back").click();
    assert.equal(await composer.inputValue(), "FIXTURE preserved mobile draft");
    await page.getByTestId("panel-tab-workspace").click();
    await page
      .getByRole("button", { name: "打开 journey.md", exact: true })
      .click();
    await page
      .getByTestId("workspace-preview")
      .getByRole("heading", { name: "FIXTURE journey file", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "返回文件列表", exact: true })
      .click();
    await page.getByTestId("panel-tab-chat").click();
    assert.equal(await composer.inputValue(), "FIXTURE preserved mobile draft");
    await page.setViewportSize({ width: 390, height: 560 });
    await composer.click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await composer.inputValue(), "FIXTURE preserved mobile draft");
    assert.deepEqual(errors, []);
    return {
      width: 390,
      chatSend: true,
      threadReply: true,
      filePreview: true,
      draftPreserved: true,
      shortViewport: true,
      errors,
    };
  } finally {
    await context.close();
  }
}
