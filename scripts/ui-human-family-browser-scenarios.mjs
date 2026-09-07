import assert from "node:assert/strict";
import { join } from "node:path";

// Mutating acceptance is restricted to startShellFixture's disposable Kernel.
// Never run this scenario against the user's formal workbench.
export async function verifyHumanFamily(browser, origin, output, engine) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.addInitScript(() => {
    if (window === window.top)
      localStorage.setItem("rah:web-push-desired:v1", "disabled");
  });
  const errors = [];
  const isSandboxServiceWorkerError = (message) =>
    message.includes(
      "Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag",
    );
  page.on("pageerror", (e) => {
    if (!isSandboxServiceWorkerError(String(e))) errors.push(String(e));
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (isSandboxServiceWorkerError(message.text())) return;
    if (
      message.location().url === updateUrl &&
      message.text().includes("status of 409 (Conflict)")
    )
      return;
    errors.push(`${message.text()} ${message.location().url}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && response.status() !== 409)
      errors.push(`${response.status()} ${response.url()}`);
  });
  const updateUrl = `${origin}/v3/client/principals/update`;
  let initial;
  const panel = page.getByRole("region", { name: "Human 详情" });
  const edit = () =>
    panel.getByRole("button", { name: "编辑描述", exact: true });
  const field = () => panel.getByRole("textbox", { name: "描述", exact: true });
  const save = () => panel.getByRole("button", { name: "保存", exact: true });
  const openSelf = async () => {
    await page
      .getByRole("button", { name: "Agent 与成员", exact: true })
      .click();
    await page.locator(".rah-agent-human-section button").click();
    await edit().waitFor();
  };
  const saveDescription = async (value) => {
    await edit().click();
    await field().fill(value);
    const response = page.waitForResponse((r) => r.url() === updateUrl);
    await save().click();
    assert.equal((await response).status(), 200);
    await edit().waitFor();
  };
  try {
    await page.goto(`${origin}/?surface=agents`, { waitUntil: "load" });
    const reading = page.waitForResponse((r) =>
      r.url().endsWith("/humans/profile"),
    );
    await page.locator(".rah-agent-human-section button").click();
    initial = (await (await reading).json()).principal;
    await edit().waitFor();
    const humanUrl = page.url();
    assert.equal(
      await panel.getByRole("button", { name: "发送私信" }).count(),
      0,
    );
    await panel.getByRole("button", { name: "角色权限" }).click();
    const roleDialog = page.getByRole("dialog", { name: "人类角色" });
    await roleDialog.waitFor();
    assert.ok((await roleDialog.textContent()).includes("不代表操作系统账户"));
    await page.keyboard.press("Escape");
    await roleDialog.waitFor({ state: "hidden" });
    assert.equal(
      await page
        .locator(".rah-agent-human-section button")
        .getAttribute("aria-current"),
      "page",
    );
    await edit().focus();
    await page.keyboard.press("Enter");
    await field().fill("First line");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second line");
    assert.equal(await field().inputValue(), "First line\nSecond line");
    assert.equal(await field().getAttribute("maxlength"), "3000");
    const write = page.waitForResponse((r) => r.url() === updateUrl);
    await save().click();
    const response = await write;
    assert.equal(response.status(), 200);
    assert.ok(response.request().postDataJSON().expectedProfile);
    await edit().waitFor();
    assert.equal(
      await panel.locator(".rah-profile-description").textContent(),
      "First line\nSecond line",
    );
    await edit().click();
    await field().fill("Cancelled draft");
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("aria-label") === "编辑描述",
    );
    assert.equal(
      await panel.locator(".rah-profile-description").textContent(),
      "First line\nSecond line",
    );

    // A second editor changes the canonical row while this one keeps its baseline.
    await edit().click();
    await field().fill("Keep this failed draft");
    const concurrent = await page.request.post(updateUrl, {
      data: {
        displayName: initial.displayName ?? initial.handle,
        avatarKey: initial.avatarKey ?? null,
        description: "Newer remote edit",
      },
    });
    assert.equal(concurrent.status(), 200);
    const conflict = page.waitForResponse((r) => r.url() === updateUrl);
    await save().click();
    assert.equal((await conflict).status(), 409);
    await panel.getByRole("alert").waitFor();
    assert.equal(await field().inputValue(), "Keep this failed draft");
    await panel.getByRole("button", { name: "取消", exact: true }).click();
    await page.reload({ waitUntil: "load" });
    await edit().waitFor();
    assert.equal(
      await panel.locator(".rah-profile-description").textContent(),
      "Newer remote edit",
    );

    // Profile uploads bind an existing profile image intent; no generated avatar store.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4V7viPwAHwwMjerDEwwAAAABJRU5ErkJggg==",
      "base64",
    );
    const uploaded = page.waitForResponse((r) => r.url() === updateUrl);
    await panel
      .locator('input[type="file"]')
      .setInputFiles({ name: "human.png", mimeType: "image/png", buffer: png });
    assert.equal((await uploaded).status(), 200);
    await panel.locator(".rah-profile-identity img").waitFor();
    await panel.locator(".rah-profile-identity img").evaluate(async (image) => {
      await image.decode();
      assertImage();
      function assertImage() {
        if (!image.naturalWidth)
          throw new Error("uploaded image did not decode");
      }
    });
    const avatar = await panel
      .locator(".rah-profile-identity img")
      .getAttribute("src");
    assert.equal(
      await page.locator(".rah-agent-human-section img").getAttribute("src"),
      avatar,
    );

    // Account editing shares the same mutation; navigation must not reload the app.
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "账户", exact: true }).click();
    const name = `Human family ${engine}`;
    await page
      .getByRole("textbox", { name: "显示名称", exact: true })
      .fill(name);
    const renamed = page.waitForResponse((r) => r.url() === updateUrl);
    await page.getByRole("button", { name: "保存资料", exact: true }).click();
    assert.equal((await renamed).status(), 200);
    await openSelf();
    assert.equal(
      await panel.locator(".rah-profile-identity h2").textContent(),
      name,
    );
    assert.equal(
      await panel.locator(".rah-profile-description").textContent(),
      "Newer remote edit",
    );
    await panel.locator(".rah-entity-card").first().click();
    await page.getByRole("tab", { name: /资料/ }).click();
    const creator = page.locator(".rah-agent-creator-identity");
    await creator.waitFor();
    assert.ok((await creator.textContent()).includes(name));
    await creator.hover();
    await page.locator(".rah-human-preview").waitFor();
    assert.deepEqual(
      await page.locator(".rah-human-preview").evaluate((e) => {
        const s = getComputedStyle(e);
        return [s.borderTopWidth, s.zIndex];
      }),
      ["2px", "110"],
    );
    assert.match(
      await page
        .locator(".rah-human-preview")
        .evaluate((e) => getComputedStyle(e).backgroundColor),
      /^(rgb\(255, 255, 255\)|oklch\(1 0 0\))$/,
    );
    await page.screenshot({ path: join(output, `${engine}-human-hover.png`) });
    assert.ok(
      (await page.locator(".rah-human-preview").textContent()).includes(
        "Newer remote edit",
      ),
    );
    await page.keyboard.press("Escape");
    await creator.click();
    await edit().waitFor();
    assert.equal(page.url(), humanUrl);

    // Graph and conversation entrances point at the same typed Human route.
    await page.getByRole("button", { name: "关系图", exact: true }).click();
    const node = page.locator(".rah-member-graph-node-trigger.is-human");
    await node.waitFor();
    assert.ok((await node.textContent()).includes("Human family"));
    await node.click();
    await edit().waitFor();
    await page
      .getByRole("button", { name: "聊天", exact: true })
      .first()
      .click();
    const messageAvatar = page.locator(".rah-message-avatar-trigger").first();
    await messageAvatar.waitFor();
    await messageAvatar.click();
    await edit().waitFor();
    await page
      .getByRole("button", { name: "聊天", exact: true })
      .first()
      .click();
    const composer = page.getByRole("textbox", {
      name: "消息输入框",
      exact: true,
    });
    await composer.fill(`@${initial.handle} Human profile link ${engine}`);
    const posted = page.waitForResponse((r) =>
      r.url().endsWith("/messages/post"),
    );
    await composer.press("Enter");
    const postedResponse = await posted;
    assert.equal(postedResponse.status(), 200);
    const postedMessage = await postedResponse.json();
    // The response precedes rendering; never click an older Agent mention.
    const mention = page.locator(
      `.msg[data-message-id=${JSON.stringify(postedMessage.event.aggregateId)}] button.rah-rich-self-reference`,
    );
    await mention.waitFor();
    await mention.click();
    await edit().waitFor();
    assert.equal(page.url(), humanUrl);

    // Same editor/component at narrow width; save/clear/reload and no horizontal overflow.
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await saveDescription(
        `Description ${engine} ${width}\n${"long text ".repeat(18)}`,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        width,
      );
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: join(output, `${engine}-human-family-${width}.png`),
      });
      await edit().click();
      await field().fill("Pending draft");
      assert.equal(
        await save().evaluate((e) => getComputedStyle(e).backgroundColor),
        "rgb(254, 125, 168)",
      );
      await page.screenshot({
        path: join(output, `${engine}-human-editor-${width}.png`),
      });
      await panel.getByRole("button", { name: "取消", exact: true }).click();
    }
    await saveDescription("");
    await page.reload({ waitUntil: "load" });
    await edit().waitFor();
    assert.equal(await panel.getByText("暂无描述", { exact: true }).count(), 1);

    // A delayed successful save updates only its identity, never reopens its page.
    await page.setViewportSize({ width: 1440, height: 900 });
    let release, arrived;
    const releaseResponse = new Promise((resolve) => {
      release = resolve;
    });
    const responseArrived = new Promise((resolve) => {
      arrived = resolve;
    });
    await page.route(updateUrl, async (route) => {
      const result = await route.fetch();
      arrived();
      await releaseResponse;
      await route.fulfill({ response: result });
    });
    await edit().click();
    await field().fill("Late save kept");
    await save().click();
    await responseArrived;
    await page.getByRole("button", { name: "任务", exact: true }).click();
    const destination = page.url();
    const completed = page.waitForResponse((r) => r.url() === updateUrl);
    release();
    await completed;
    await page.unroute(updateUrl);
    await page.getByRole("button", { name: "创建者", exact: true }).waitFor();
    assert.equal(page.url(), destination);
    assert.equal(await panel.count(), 0);
    await openSelf();
    assert.equal(
      await panel.locator(".rah-profile-description").textContent(),
      "Late save kept",
    );
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({
      path: join(output, `${engine}-human-family-failed.png`),
    });
    throw error;
  } finally {
    if (initial) {
      const restored = await page.request.post(updateUrl, {
        data: {
          displayName: initial.displayName ?? initial.handle,
          avatarKey: initial.avatarKey ?? null,
          description: initial.description ?? null,
        },
      });
      assert.equal(restored.status(), 200);
    }
    await page.close();
  }
}
