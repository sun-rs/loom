import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyPreviewContent(page, output, engine) {
  const fixture = page.locator('[data-fixture="agent-preview-content"]');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const mode of [
      "other",
      "creator",
      "manager",
      "empty",
      "activity-error",
      "profile-error",
    ]) {
      // selectOption changes fixture data without moving the pointer. Move out
      // before hovering the newly mounted identity (Firefox emits no enter for
      // a pointer that stayed at identical coordinates across replacement).
      await page.mouse.move(1, 1);
      await fixture.getByRole("combobox").selectOption(mode);
      await fixture.getByRole("button").hover();
      const preview = page.locator(".rah-agent-preview");
      await preview.waitFor();
      await page.waitForFunction(
        () =>
          !document
            .querySelector(".rah-agent-preview")
            ?.textContent.includes("加载中…"),
      );
      if (mode === "profile-error") {
        assert.ok((await preview.textContent()).includes("暂时无法读取"));
      } else assert.ok((await preview.textContent()).includes("Runtime 默认"));
      assert.equal(
        await preview.getByText("推理强度", { exact: true }).count(),
        0,
      );
      const reads = await fixture
        .locator("[data-trajectory-reads]")
        .textContent();
      assert.equal(
        reads,
        ["other", "profile-error"].includes(mode) ? "0" : "1",
      );
      if (["other", "empty", "profile-error"].includes(mode))
        assert.equal(
          await preview.getByText("最近动态", { exact: true }).count(),
          0,
        );
      else if (mode === "activity-error")
        await preview.getByText("暂时无法读取动态", { exact: true }).waitFor();
      else {
        await preview.getByText("Running command", { exact: true }).waitFor();
        assert.equal(
          await preview
            .locator(".rah-preview-event")
            .first()
            .evaluate((e) => getComputedStyle(e).lineHeight),
          "16px",
        );
        assert.equal(
          (await preview.textContent()).includes("PRIVATE COMMAND"),
          false,
        );
      }
      const box = await preview.boundingBox();
      const avatarBox = await preview
        .locator(".rah-agent-preview-identity > .rah-agent-avatar")
        .boundingBox();
      assert.deepEqual(
        [avatarBox.width, avatarBox.height],
        [48, 48],
        "compact preview avatar must not inherit the 64px full-profile size",
      );
      assert.ok(box.x >= 0 && box.x + box.width <= width);
      assert.equal(
        await preview
          .locator("dl")
          .evaluate((e) => getComputedStyle(e).borderTopWidth),
        "1px",
      );
      if (mode === "manager") {
        const retained = await preview.elementHandle();
        // Simulate a new canonical presence projection without a click, remount,
        // new client, or manual reload. The existing hover must stay mounted.
        await page.evaluate(() =>
          window.dispatchEvent(new Event("fixture-presence")),
        );
        await preview
          .getByText("updated_fixture_tool", { exact: true })
          .waitFor({ timeout: 3000 });
        assert.equal(await retained.evaluate((e) => e.isConnected), true);
        assert.equal(
          await fixture.locator("[data-trajectory-reads]").textContent(),
          "2",
        );
        await page.screenshot({
          path: join(output, `${engine}-agent-preview-${width}.png`),
        });
      }
      await page.keyboard.press("Escape");
      assert.equal(await preview.count(), 0);
    }
  }
}

export async function verifyPreviewLifetime(page) {
  await page.clock.install();
  try {
    const trigger = page.getByRole("button", {
      name: "预览时序测试",
      exact: true,
    });
    await trigger.focus();
    await page.keyboard.press("Escape");
    await page.clock.runFor(300);
    assert.equal(
      await page.getByRole("tooltip").count(),
      0,
      "Escape cancels a scheduled preview before it opens",
    );
    await trigger.blur();
    await trigger.focus();
    await page.clock.runFor(220);
    await page.getByRole("tooltip").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("tooltip").count(), 0);
    await trigger.blur();
    await trigger.hover();
    await page.clock.runFor(220);
    const card = page.getByRole("tooltip");
    await card.hover();
    await page.clock.runFor(200);
    assert.equal(
      await card.count(),
      1,
      "moving from avatar onto preview must retain it",
    );
    await page.mouse.click(1, 1);
    assert.equal(await card.count(), 0);
  } finally {
    await page.clock.resume();
  }
}

// Production consumers and real canonical API; writes restricted to disposable fixtures.
export async function verifyProfileFamily(browser, origin, output, engine) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.addInitScript(() =>
    localStorage.setItem("rah:web-push-desired:v1", "disabled"),
  );
  const errors = [];
  const isSandboxServiceWorkerError = (message) =>
    message.includes(
      "Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag",
    );
  page.on("pageerror", (e) => {
    if (!isSandboxServiceWorkerError(String(e))) errors.push(String(e));
  });
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !isSandboxServiceWorkerError(message.text())
    )
      errors.push(`${message.text()} ${message.location().url}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  try {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto(`${origin}/?surface=computers`, {
        waitUntil: "load",
      });
      const card = page
        .locator(".rah-computer-agent-list button.rah-entity-card")
        .first();
      await card.waitFor();
      const fields = page.locator(".rah-computer-field");
      assert.equal(await fields.count(), 2);
      for (const field of await fields.all()) {
        assert.ok(
          await field.evaluate((el) => {
            const button = el.querySelector("h3 button");
            return (
              button &&
              button.getBoundingClientRect().left -
                el.getBoundingClientRect().left <
                120
            );
          }),
          "Field edit icons stay beside their labels, unlike section toolbar actions",
        );
        assert.deepEqual(
          await field.evaluate((e) => {
            const s = getComputedStyle(e);
            return [s.paddingTop, s.paddingLeft, s.borderTopWidth, s.minHeight];
          }),
          ["16px", "20px", "1px", "0px"],
        );
      }
      const disclosure = page.locator("details").filter({
        has: page.locator("summary", { hasText: "CLI / Runtime / Offer 详情" }),
      });
      assert.equal(await disclosure.getAttribute("open"), null);
      await disclosure.locator("summary").click();
      assert.notEqual(await disclosure.getAttribute("open"), null);
      await disclosure.locator("summary").press("Enter");
      assert.equal(await disclosure.getAttribute("open"), null);
      if (width === 1440) {
        const description = page
          .locator(".rah-computer-field")
          .filter({ hasText: "描述" });
        await description
          .getByRole("button", { name: "编辑计算机描述" })
          .click();
        const input = page.getByRole("textbox", {
          name: "计算机描述",
          exact: true,
        });
        await input.fill(`Computer family ${engine} first line`);
        await input.press("End");
        await input.press("Enter");
        await input.pressSequentially("Second line");
        assert.equal(
          await input.inputValue(),
          `Computer family ${engine} first line\nSecond line`,
        );
        const response = page.waitForResponse((r) =>
          r.url().endsWith("/computers/profile/update"),
        );
        await description
          .getByRole("button", { name: "保存", exact: true })
          .click();
        const saved = await response;
        assert.equal(saved.status(), 200);
        assert.equal(
          typeof saved.request().postDataJSON().expectedRevision,
          "number",
        );
        await description
          .getByRole("button", { name: "编辑计算机描述" })
          .waitFor();
        await page.reload({ waitUntil: "load" });
        await description.filter({ hasText: "Second line" }).waitFor();
        assert.ok((await description.textContent()).includes("Second line"));
        await description
          .getByRole("button", { name: "编辑计算机描述" })
          .click();
        await input.fill("Discard this draft");
        await input.press("Escape");
        assert.ok((await description.textContent()).includes("Second line"));
      }
      await page.screenshot({
        path: join(output, `${engine}-computer-family-${width}.png`),
        fullPage: true,
      });
      const agentName = await card
        .locator(".rah-entity-card-name")
        .textContent();
      await card.click();
      await page.getByRole("tab", { name: /资料/ }).click();
      const profile = page.locator(".rah-agent-profile-pane");
      await profile.waitFor();
      assert.equal(
        await profile.locator(".rah-agent-profile-identity h3").textContent(),
        agentName,
      );
      assert.equal(
        (await profile.locator(".rah-profile-section").count()) > 0,
        true,
      );
      const description = profile
        .locator(".rah-agent-profile-field")
        .filter({ hasText: "描述" });
      if (width === 1440) {
        await description
          .getByRole("button", { name: "编辑描述", exact: true })
          .click();
        await description
          .getByRole("textbox")
          .fill(`Agent family ${engine}: stable canonical description`);
        const response = page.waitForResponse((r) =>
          r.url().endsWith("/agents/manage"),
        );
        await description
          .getByRole("button", { name: "保存", exact: true })
          .click();
        assert.equal((await response).status(), 200);
        await description
          .getByRole("button", { name: "编辑描述", exact: true })
          .waitFor();
        await page.reload({ waitUntil: "load" });
        await description
          .filter({ hasText: `Agent family ${engine}` })
          .waitFor();
        assert.ok(
          (await description.textContent()).includes(`Agent family ${engine}`),
        );
      }
      await description
        .getByRole("button", { name: "编辑描述", exact: true })
        .click();
      await description.getByRole("textbox").fill("Cancel edit");
      await description.getByRole("textbox").press("Escape");
      assert.equal(await description.getByRole("textbox").count(), 0);
      await profile
        .getByRole("button", { name: "编辑运行时配置", exact: true })
        .click();
      const runtimeDialog = page.getByRole("dialog", {
        name: "编辑运行时配置",
        exact: true,
      });
      await runtimeDialog.waitFor();
      assert.equal(
        await runtimeDialog
          .getByRole("button", { name: "保存运行时配置", exact: true })
          .isDisabled(),
        true,
      );
      await runtimeDialog
        .getByRole("button", { name: "取消", exact: true })
        .click();
      await runtimeDialog.waitFor({ state: "hidden" });
      for (const label of ["重启 / 重置", "报告问题"]) {
        await profile.getByRole("button", { name: label, exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        width,
      );
      await page.screenshot({
        path: join(output, `${engine}-agent-family-${width}.png`),
        fullPage: true,
      });
      await profile
        .getByRole("button", { name: "打开计算机资料", exact: true })
        .click();
      await page.locator(".rah-computer-hero").waitFor();
    }
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({
      path: join(output, `${engine}-profile-family-failure.png`),
    });
    throw error;
  } finally {
    await page.close();
  }
}
