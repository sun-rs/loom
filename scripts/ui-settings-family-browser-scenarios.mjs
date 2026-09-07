import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifySettingsFamily(page, origin, output, engine) {
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (
        window.__rahFailTimeFormatStorage === true &&
        key === "rah:settings:time-format"
      )
        throw new Error("Fixture storage unavailable");
      return originalSetItem.call(this, key, value);
    };
    Object.defineProperty(Notification, "permission", { get: () => "granted" });
    Object.defineProperty(navigator.serviceWorker, "getRegistration", {
      value: async () => ({
        update: async () => {},
        pushManager: {
          getSubscription: async () => ({
            endpoint: "https://fixture.invalid",
          }),
        },
      }),
    });
  });
  const url = `${origin}/test/ui-foundations.html?settings-fixture=1`;
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() =>
      localStorage.removeItem("rah:settings:time-format"),
    );
    await page.reload({ waitUntil: "load" });
    const name = page.getByRole("textbox", { name: "名称", exact: true });
    const save = page.getByRole("button", { name: "保存资料", exact: true });
    await name.waitFor();
    assert.equal(await save.isDisabled(), true, "pristine form cannot submit");
    await name.fill("Draft Workspace");
    await page.getByText("Fixture refresh", { exact: true }).click();
    assert.equal(
      await name.inputValue(),
      "Draft Workspace",
      "polling must preserve drafts",
    );
    await name.press("Enter");
    await page.locator('[data-writes="1"]').waitFor({ state: "attached" });
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === "保存资料" && b.disabled,
      ),
    );
    await name.fill("Second Save");
    await page.getByText("Fixture remote event", { exact: true }).click();
    await name.press("Enter");
    await page
      .getByRole("alert")
      .filter({ hasText: "Guessed sequence rejected" })
      .waitFor();
    assert.equal(
      await name.inputValue(),
      "Second Save",
      "conflict retains draft",
    );
    await page
      .getByRole("button", { name: "读取最新版本后重试", exact: true })
      .click();
    await name.press("Enter");
    await page.locator('[data-writes="2"]').waitFor({ state: "attached" });
    assert.equal(
      await page.getByRole("alert").count(),
      0,
      "second save must use observed, not guessed, sequence",
    );
    await page.getByText("Fixture defer", { exact: true }).click();
    await name.fill("Late obsolete save");
    await name.press("Enter");
    await page.locator('[data-writes="3"]').waitFor({ state: "attached" });
    await page.getByText("Fixture switch", { exact: true }).click();
    await page.getByText("Fixture resolve", { exact: true }).click();
    await page.waitForTimeout(80);
    assert.equal(await name.inputValue(), "Second Workspace");
    assert.equal(
      await page.locator("[data-updated]").getAttribute("data-updated"),
      "fixture-a",
      "late completion must not call onUpdated for new scope",
    );
    const slug = page.getByRole("textbox", { name: "短名 (slug)" });
    assert.equal(await slug.getAttribute("readonly"), "");
    assert.equal(
      await slug.evaluate((el) => getComputedStyle(el).boxShadow),
      "none",
    );
    await page.getByText("Fixture read error", { exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Fixture baseline unavailable" })
      .waitFor();
    assert.equal(await save.isDisabled(), true);
    await page.getByText("Fixture read recovery", { exact: true }).click();
    await page
      .getByRole("button", { name: "读取最新版本后重试", exact: true })
      .click();
    await page.waitForFunction(
      () => !document.querySelector('input[maxlength="120"]').disabled,
    );
    await page.getByText("Fixture deny", { exact: true }).click();
    assert.equal(await name.isDisabled(), true);
    await page.screenshot({
      path: join(output, `${engine}-settings-server-${viewport.width}.png`),
    });
    await page.getByText("Fixture administration", { exact: true }).click();
    assert.equal(
      await page.getByText("所有者", { exact: true }).count(),
      0,
      "unknown role must not be owner",
    );
    await page.getByText("Fixture language", { exact: true }).click();
    assert.equal(
      await page.getByRole("combobox", { name: "显示语言" }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("radio", { name: "自动", exact: true }).count(),
      0,
    );
    assert.equal(await page.getByText("时区", { exact: true }).count(), 0);
    const time12 = page.getByRole("radio", { name: "12 小时制" });
    const time24 = page.getByRole("radio", { name: "24 小时制" });
    await time24.focus();
    await time24.press("ArrowLeft");
    assert.equal(await time12.isChecked(), true);
    const saveDateTime = page.getByRole("button", {
      name: "保存日期与时间",
      exact: true,
    });
    assert.equal(await saveDateTime.isDisabled(), false);
    await saveDateTime.focus();
    await saveDateTime.press("Enter");
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.rahTimeFormat),
      "12",
    );
    assert.equal(await time12.isChecked(), true);
    assert.equal(await time24.isChecked(), false);
    await page.getByRole("status").filter({ hasText: "已保存" }).waitFor();
    await page.reload({ waitUntil: "load" });
    await page.getByText("Fixture language", { exact: true }).click();
    assert.equal(
      await page.getByRole("radio", { name: "12 小时制" }).isChecked(),
      true,
      "time format persists on this device",
    );
    await page.evaluate(() => {
      window.__rahFailTimeFormatStorage = true;
    });
    await page.getByRole("radio", { name: "24 小时制" }).check();
    await page
      .getByRole("button", { name: "保存日期与时间", exact: true })
      .click();
    await page.getByRole("alert").filter({ hasText: "仅本次生效" }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "保存日期与时间", exact: true })
        .isDisabled(),
      false,
      "failed storage keeps the draft dirty",
    );
    await page.reload({ waitUntil: "load" });
    await page.getByText("Fixture language", { exact: true }).click();
    assert.equal(
      await page.getByRole("radio", { name: "12 小时制" }).isChecked(),
      true,
      "failed storage does not change the persisted value",
    );
    await page.getByText("Fixture appearance", { exact: true }).click();
    const preview = page.locator(".rah-settings-message-preview");
    assert.equal(
      await preview.evaluate((el) => getComputedStyle(el).borderTopWidth),
      "0px",
    );
    assert.equal(
      await preview.locator(".msg-body code").innerText(),
      "git pull",
    );
    assert.equal(
      await preview.evaluate((el) => el.inert),
      true,
      "demo identities must be inert to keyboard as well as pointer",
    );
    const toggle = page.getByRole("checkbox", { name: "实时 Agent 动态" });
    await toggle.focus();
    const initial = await toggle.isChecked();
    await toggle.press("Space");
    assert.equal(await toggle.isChecked(), !initial);
    await page.getByRole("button", { name: "大", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "大", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.screenshot({
      path: join(output, `${engine}-settings-appearance-${viewport.width}.png`),
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "no horizontal page overflow",
    );
    await page.getByText("Fixture notifications", { exact: true }).click();
    const test = page.getByRole("button", {
      name: "发送测试推送",
      exact: true,
    });
    await test.waitFor();
    assert.equal(
      await test.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(169, 216, 119)",
    );
    assert.equal(
      await page
        .locator(".rah-settings-push-card .rah-count-badge")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(255, 212, 64)",
    );
    await test.click();
    await page
      .getByRole("status")
      .filter({ hasText: "已提交测试推送，请检查系统通知。" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "保存", exact: true })
        .isDisabled(),
      true,
    );
    await page.screenshot({
      path: join(
        output,
        `${engine}-settings-notifications-${viewport.width}.png`,
      ),
    });
    await page.getByText("Fixture account", { exact: true }).click();
    const displayName = page.getByRole("textbox", {
      name: "显示名称",
      exact: true,
    });
    assert.equal(await save.isDisabled(), true);
    await displayName.fill("Renamed Human");
    await displayName.press("Enter");
    await page
      .locator('[data-account-writes="1"]')
      .waitFor({ state: "attached", timeout: 3000 });
    assert.equal(await displayName.inputValue(), "Renamed Human");
  }
}

export async function verifySettingsNavigation(page, origin, output, engine) {
  const sections = [
    ["account", "账户"],
    ["language-region", "日期与时间"],
    ["appearance", "外观"],
    ["notifications", "通知"],
    ["server", "服务器资料"],
    ["administration", "管理"],
    ["managed-mcp", "MCP 服务器"],
    ["lan-devices", "局域网设备"],
    ["about", "关于"],
    ["docs", "文档"],
    ["feedback", "反馈"],
    ["release-notes", "更新日志"],
  ];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(`${origin}/?surface=settings`, {
      waitUntil: "load",
    });
    for (const [section, label] of sections) {
      const nav = page.locator(
        width === 390
          ? ".rah-settings-mobile-index"
          : ".rah-settings-navigation:not(.rah-settings-mobile-index)",
      );
      await nav
        .getByRole("button", { name: label, exact: section !== "lan-devices" })
        .click();
      await page
        .locator(".rah-settings-page-head")
        .getByRole("heading", { name: label, exact: true })
        .waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(width - 5, 70);
      await page.waitForTimeout(180);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        label,
      );
      if (section === "appearance") {
        assert.equal(
          await page
            .locator(".rah-settings-message-preview")
            .evaluate((el) => el.inert),
          true,
        );
        // The actual app supplies identity context; inert must protect real buttons.
        const token = page
          .locator(".rah-settings-message-preview button")
          .first();
        if (await token.count()) {
          await token.evaluate((el) => el.focus());
          assert.equal(
            await token.evaluate((el) => el === document.activeElement),
            false,
          );
        }
      }
      if (section === "lan-devices") {
        await page.getByText("LAN 设备管理未启用", { exact: true }).waitFor();
        assert.equal(
          await page
            .getByRole("button", { name: "生成配对码", exact: true })
            .isDisabled(),
          true,
        );
      }
      await page.screenshot({
        path: join(output, `${engine}-settings-tab-${section}-${width}.png`),
      });
      if (width === 390)
        await page
          .getByRole("button", { name: "返回设置", exact: true })
          .click();
    }
  }
}
