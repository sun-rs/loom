import assert from "node:assert/strict";
import { join } from "node:path";

const taskEmptyGeometry = async (empty) => ({
  icon: await empty
    .locator(".rah-empty-state-icon > svg")
    .evaluate((element) => getComputedStyle(element).width),
  title: await empty
    .locator(".rah-empty-state-title")
    .evaluate((element) => getComputedStyle(element).fontSize),
  titleLine: await empty
    .locator(".rah-empty-state-title")
    .evaluate((element) => getComputedStyle(element).lineHeight),
  body: await empty
    .locator(".rah-empty-state-description")
    .evaluate((element) => getComputedStyle(element).fontSize),
});

/**
 * Real production Search/Tasks/Message composition against the isolated
 * Kernel/daemon fixture. This is a browser state matrix, not a fixture UI.
 */
export async function verifyDiscoveryFamily(page, origin, output, engine) {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${origin}/?surface=tasks`, { waitUntil: "networkidle" });
    const empty = page.locator(
      '.rah-empty-state[data-context="task"][data-placement="fill"]',
    );
    await empty.waitFor();
    assert.deepEqual(await taskEmptyGeometry(empty), {
      icon: "36px",
      title: "18px",
      titleLine: "28px",
      body: "14px",
    });
    assert.equal(
      await empty.getByText("暂无任务", { exact: true }).count(),
      1,
      "an unfiltered empty workspace is not described as a failed filter",
    );

    const creator = page.getByRole("button", {
      name: "创建者",
      exact: true,
    });
    await creator.click();
    const menu = page.getByRole("menu", { name: "创建者筛选" });
    await menu.waitFor();
    const search = menu.getByRole("textbox", { name: "搜索创建者" });
    assert.equal(
      await search.evaluate((element) => getComputedStyle(element).borderWidth),
      "2px",
    );
    const searchShadow = await search.evaluate(
      (element) => getComputedStyle(element).boxShadow,
    );
    assert.ok(
      searchShadow.includes("4px 4px") && !searchShadow.includes("blur"),
      `the auto-focused Raft filter search keeps its hard focus shadow: ${searchShadow}`,
    );
    const sentinel = menu.getByRole("menuitemcheckbox", {
      name: "我创建的",
      exact: true,
    });
    await sentinel.waitFor();
    assert.equal(
      await sentinel.locator(".rah-agent-avatar, .rah-settings-avatar").count(),
      0,
      "the self shortcut is a sentinel, not a duplicated Human avatar",
    );
    assert.ok(
      (await menu.locator(".rah-agent-avatar").count()) >= 1,
      "canonical Agent rows retain their real avatar identity",
    );
    if (width === 1440) {
      await sentinel.click();
      assert.ok(new URL(page.url()).searchParams.has("creator"));
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      const clearTaskFilters = page.getByRole("button", {
        name: "清除筛选",
        exact: true,
      });
      await clearTaskFilters.click();
      assert.equal(new URL(page.url()).searchParams.has("creator"), false);

      const channel = page.getByRole("button", {
        name: "频道",
        exact: true,
      });
      await channel.click();
      const channelMenu = page.getByRole("menu", { name: "频道筛选" });
      await channelMenu.waitFor();
      await channelMenu.getByRole("menuitemcheckbox").first().click();
      await page.keyboard.press("Escape");
      assert.ok(new URL(page.url()).searchParams.has("channel"));
      await clearTaskFilters.click();

      const assignee = page.getByRole("button", {
        name: "负责人",
        exact: true,
      });
      await assignee.click();
      const assigneeMenu = page.getByRole("menu", { name: "负责人筛选" });
      await assigneeMenu.waitFor();
      for (const name of ["分配给我的", "未分配"]) {
        const option = assigneeMenu.getByRole("menuitemcheckbox", {
          name,
          exact: true,
        });
        await option.waitFor();
        assert.equal(
          await option
            .locator(".rah-agent-avatar, .rah-settings-avatar")
            .count(),
          0,
          `${name} is a sentinel, not a duplicated identity`,
        );
      }
      await assigneeMenu
        .getByRole("menuitemcheckbox", { name: "未分配", exact: true })
        .click();
      await page.keyboard.press("Escape");
      assert.deepEqual(new URL(page.url()).searchParams.getAll("assignee"), [
        "unassigned",
      ]);
      await clearTaskFilters.click();
    } else {
      await search.fill("no-such-task-person");
      await menu.getByText("没有匹配项", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
    }
    if (width !== 1440)
      assert.equal(
        await creator.evaluate((element) => document.activeElement === element),
        true,
        "Escape closes the Task filter and restores focus",
      );

    const list = page.getByRole("radio", { name: "列表", exact: true });
    await list.click();
    assert.equal(await list.getAttribute("aria-checked"), "true");
    assert.ok(new URL(page.url()).searchParams.get("view") === "list");
    await page.screenshot({
      path: join(output, `${engine}-discovery-tasks-${width}.png`),
    });

    await page.goto(`${origin}/?surface=search`, {
      waitUntil: "networkidle",
    });
    const query = page.getByRole("textbox", {
      name: "搜索频道、私信、消息",
    });
    await query.fill(`no-result-${engine}-${width}-rah-contract`);
    const noResult = page.locator(
      '.rah-empty-state[data-context="search"][data-placement="section"]',
    );
    await noResult.getByText("没有搜索结果", { exact: true }).waitFor();
    assert.equal(
      await page
        .locator(".search-stage")
        .getByText("0", { exact: true })
        .count(),
      0,
      "zero-length JSX branches cannot leak a numeric 0 into Search results",
    );
    assert.equal(
      await page.locator(".search-stage > .empty-state").count(),
      0,
      "Search no-result cannot fall back to the removed page-private empty DOM",
    );
    if (width === 1440) {
      const sender = page.getByRole("button", {
        name: "发送者",
        exact: true,
      });
      await sender.click();
      const senderMenu = page.getByRole("menu", { name: "发送者筛选" });
      await senderMenu.waitFor();
      await senderMenu.getByRole("menuitemradio").last().click();
      assert.ok(new URL(page.url()).searchParams.has("sender"));

      await page.getByRole("button", { name: "范围", exact: true }).click();
      const scopeMenu = page.getByRole("menu", { name: "范围筛选" });
      await scopeMenu
        .getByRole("menuitemcheckbox", { name: "Agent", exact: true })
        .click();
      await page.keyboard.press("Escape");
      assert.deepEqual(new URL(page.url()).searchParams.getAll("scope"), [
        "agents",
      ]);

      await page.getByRole("button", { name: "频道", exact: true }).click();
      const searchChannelMenu = page.getByRole("menu", {
        name: "频道筛选",
      });
      await searchChannelMenu.getByRole("menuitemradio").first().click();
      assert.ok(new URL(page.url()).searchParams.has("channel"));

      await page.getByRole("button", { name: "不限时间", exact: true }).click();
      await page
        .getByRole("menu", { name: "时间筛选" })
        .getByRole("menuitemradio", { name: "最近7天", exact: true })
        .click();
      assert.equal(new URL(page.url()).searchParams.get("time"), "7d");

      await page.getByRole("button", { name: "相关度", exact: true }).click();
      await page
        .getByRole("menu", { name: "排序筛选" })
        .getByRole("menuitemradio", { name: "最新", exact: true })
        .click();
      assert.equal(new URL(page.url()).searchParams.get("sort"), "recent");

      await page
        .locator(".filter-bar")
        .getByRole("button", { name: "清除筛选", exact: true })
        .click();
      const cleared = new URL(page.url()).searchParams;
      assert.equal(cleared.get("q"), await query.inputValue());
      for (const key of ["sender", "scope", "channel", "time", "sort"])
        assert.equal(cleared.has(key), false, `${key} filter was not cleared`);
      await page.getByRole("button", { name: "清除搜索", exact: true }).click();
      assert.equal(
        await query.evaluate((element) => document.activeElement === element),
        true,
      );
      await page.getByRole("heading", { name: "搜索历史" }).waitFor();
    }
    await page.screenshot({
      path: join(output, `${engine}-discovery-search-empty-${width}.png`),
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  const composer = page.locator(
    'textarea[aria-label="消息输入框"]:not(:disabled)',
  );
  await composer.waitFor();
  const message = page.locator(".msg:has(.msg-actions)").first();
  await message.waitFor();
  const actions = message.locator(".msg-actions");
  assert.equal(
    await actions.evaluate((element) => getComputedStyle(element).opacity),
    "0",
  );
  await message.hover();
  await page.waitForFunction(
    (id) =>
      getComputedStyle(
        document.querySelector(
          `[data-message-id="${CSS.escape(id)}"] .msg-actions`,
        ),
      ).opacity === "1",
    await message.getAttribute("data-message-id"),
  );
  assert.equal(
    await actions.evaluate((element) => getComputedStyle(element).opacity),
    "1",
  );
  assert.equal(
    await actions.getByRole("button").count(),
    3,
    "ordinary messages expose Thread, reaction and bookmark actions",
  );
  for (const button of await actions.getByRole("button").all()) {
    const box = await button.boundingBox();
    assert.deepEqual([box.width, box.height], [24, 24]);
  }
  await actions.getByRole("button", { name: "添加回应" }).click();
  const reactions = page.getByRole("menu", { name: "添加回应筛选" });
  await reactions.waitFor();
  assert.equal(
    await reactions.locator('[role="menuitemradio"]').count(),
    7,
    "Raft quick-reaction set remains complete",
  );
  await reactions
    .getByRole("menuitemradio", { name: "用 👍 回应", exact: true })
    .click();
  const reactionChip = message.locator(".rah-message-reaction").first();
  await reactionChip.waitFor();
  await reactionChip.hover();
  const reactors = page.getByRole("tooltip");
  await reactors.waitFor();
  assert.match(await reactors.innerText(), /你/u);
  await page.mouse.move(0, 0);
  await reactors.waitFor({ state: "detached" });

  await message.hover();
  await actions.getByRole("button", { name: "收藏消息" }).click();
  const saved = message.locator(".rah-message-saved-badge");
  await saved.waitFor();
  await message.click({ button: "right" });
  const contextMenu = page.locator(".rah-message-context-menu");
  await contextMenu.waitFor();
  assert.equal(await contextMenu.getByRole("menuitemradio").count(), 7);
  assert.ok((await contextMenu.getByRole("menuitem").count()) >= 5);
  await page.keyboard.press("Escape");
  await contextMenu.waitFor({ state: "detached" });
  await page.screenshot({
    path: join(output, `${engine}-message-actions.png`),
  });

  await reactionChip.click();
  await reactionChip.waitFor({ state: "detached" });
  await saved.click();
  await saved.waitFor({ state: "detached" });

  const tabs = page.getByRole("tablist", { name: "对话内容", exact: true });
  await tabs.getByRole("tab", { name: "任务", exact: true }).click();
  const roomEmpty = page.locator(
    '.tasks-content .rah-empty-state[data-context="task"]',
  );
  await roomEmpty.waitFor();
  assert.deepEqual(await taskEmptyGeometry(roomEmpty), {
    icon: "36px",
    title: "18px",
    titleLine: "28px",
    body: "14px",
  });
}
