import { scrollTaskWindow } from "./task-window-browser-scroll.mjs";
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

const taskColumns = [
  ["todo", "待办", true],
  ["in-progress", "进行中", true],
  ["review", "待确认", true],
  ["done", "完成", false],
  ["closed", "已关闭", false],
];

async function postFixture(page, path, body) {
  return page.evaluate(
    async ({ body, path }) => {
      const response = await fetch(path, {
        body: JSON.stringify(body),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          `${String(response.status)} ${JSON.stringify(payload)}`,
        );
      return payload;
    },
    { body, path },
  );
}

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
    await page.goto(`${origin}/?surface=tasks`, { waitUntil: "load" });
    const openTitle =
      "Keep the Room-first delivery contract stable across a deliberately long Task title";
    const openCard = page.locator(
      `.rah-global-task-card:has-text(${JSON.stringify(openTitle)})`,
    );
    await openCard.waitFor();
    assert.equal(
      await page.locator(".rah-empty-state[data-context=task]").count(),
      0,
      "the page-family gate must exercise production Task cards, not only an empty fixture",
    );
    for (const [id, label, expanded] of taskColumns) {
      const group = page.locator(`[data-task-group="${id}"]`);
      await group.waitFor();
      const toggle = group.getByRole("button", {
        name: `${expanded ? "收起" : "展开"}${label}`,
        exact: true,
      });
      assert.equal(
        await toggle.getAttribute("aria-expanded"),
        String(expanded),
      );
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
      "the complete five-column family must remain bounded by the viewport",
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
      const agentCreator = menu
        .locator('button[role="menuitemcheckbox"]:has(.rah-agent-avatar)')
        .first();
      await agentCreator.click();
      assert.ok(new URL(page.url()).searchParams.has("creator"));
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      const filteredEmpty = page.locator(
        '.rah-empty-state[data-context="task"][data-placement="fill"]',
      );
      await filteredEmpty.waitFor();
      assert.deepEqual(await taskEmptyGeometry(filteredEmpty), {
        icon: "36px",
        title: "18px",
        titleLine: "28px",
        body: "14px",
      });
      await filteredEmpty
        .getByText("没有符合此筛选的任务", { exact: true })
        .waitFor();
      const clearTaskFilters = page.getByRole("button", {
        name: "清除筛选",
        exact: true,
      });
      await clearTaskFilters.click();
      await openCard.waitFor();
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

      const taskId = await openCard.evaluate(
        (element) => element.parentElement?.dataset.taskId,
      );
      const roomId = await openCard.evaluate(
        (element) => element.parentElement?.dataset.taskRoomId,
      );
      const taskNumber = Number(
        (await openCard.locator(".kcard-no span").innerText()).replace("#", ""),
      );
      assert.ok(taskId);
      assert.ok(Number.isInteger(taskNumber) && taskNumber > 0);
      assert.ok(roomId);
      const status = openCard.getByRole("button", {
        name: `任务 #${taskNumber} 状态：待办`,
        exact: true,
      });
      await status.click();
      const statusMenu = page.getByRole("menu", {
        name: `任务 #${taskNumber} 状态筛选`,
        exact: true,
      });
      await statusMenu.waitFor();
      assert.equal(await statusMenu.getByRole("menuitemradio").count(), 5);
      assert.equal(
        await statusMenu
          .getByRole("menuitemradio", { name: "待办", exact: true })
          .getAttribute("aria-checked"),
        "true",
      );
      for (const name of ["进行中", "待确认", "完成"])
        assert.equal(
          await statusMenu
            .getByRole("menuitemradio", { name, exact: true })
            .isDisabled(),
          true,
          `${name} cannot counterfeit canonical execution evidence`,
        );

      const closedResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/v3/client/tasks/workflow") &&
          response.request().method() === "POST",
      );
      await statusMenu
        .getByRole("menuitemradio", { name: "已关闭", exact: true })
        .click();
      const closedMutation = await (await closedResponse).json();
      assert.equal(closedMutation.task.taskId, taskId);
      assert.equal(closedMutation.task.state, "cancelled");
      assert.equal(closedMutation.task.workflowStatus, "closed");
      assert.equal(closedMutation.event.type, "task.cancelled");
      const closedList = await postFixture(page, "/v3/client/tasks/list", {
        roomId,
      });
      assert.equal(
        closedList.tasks.find((task) => task.taskId === taskId).state,
        "cancelled",
      );
      const closedLedger = await postFixture(page, "/v3/client/rooms/sync", {
        afterSeq: 0,
        consumerId: `task-page-close-${engine}`,
        limit: 500,
        roomId,
      });
      assert.ok(
        closedLedger.events.some(
          (event) =>
            event.aggregateId === taskId && event.type === "task.cancelled",
        ),
        "the UI move must exist in the canonical Room ledger",
      );

      const closedGroup = page.locator('[data-task-group="closed"]');
      const expandClosed = closedGroup.locator(":scope > .kcol-head");
      assert.equal(await expandClosed.getAttribute("aria-label"), "展开已关闭");
      await expandClosed.click();
      assert.equal(await expandClosed.getAttribute("aria-expanded"), "true");
      assert.equal(
        await expandClosed.evaluate(
          (element) => document.activeElement === element,
        ),
        true,
        "column toggle retains focus",
      );
      const closedCard = closedGroup.locator(
        `.rah-global-task-card:has-text(${JSON.stringify(openTitle)})`,
      );
      await closedCard.waitFor();
      await closedCard
        .getByRole("button", {
          name: `任务 #${taskNumber} 状态：已关闭`,
          exact: true,
        })
        .click();
      const reopenMenu = page.getByRole("menu", {
        name: `任务 #${taskNumber} 状态筛选`,
        exact: true,
      });
      await reopenMenu.waitFor();
      const reopenedResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/v3/client/tasks/workflow") &&
          response.request().method() === "POST",
      );
      await reopenMenu
        .getByRole("menuitemradio", { name: "待办", exact: true })
        .click();
      const reopenedMutation = await (await reopenedResponse).json();
      assert.equal(reopenedMutation.task.state, "todo");
      assert.equal(reopenedMutation.task.workflowStatus, "todo");
      assert.equal(reopenedMutation.event.type, "task.reopened");
      const reopenedList = await postFixture(page, "/v3/client/tasks/list", {
        roomId,
      });
      assert.equal(
        reopenedList.tasks.find((task) => task.taskId === taskId).state,
        "todo",
      );
      const reopenedLedger = await postFixture(page, "/v3/client/rooms/sync", {
        afterSeq: 0,
        consumerId: `task-page-reopen-${engine}`,
        limit: 500,
        roomId,
      });
      assert.ok(
        reopenedLedger.events.some(
          (event) =>
            event.aggregateId === taskId && event.type === "task.reopened",
        ),
      );
      await openCard.waitFor();

      const terminalToggle = page
        .locator('[data-task-group="closed"]')
        .locator(":scope > .kcol-head");
      assert.equal(
        await terminalToggle.getAttribute("aria-label"),
        "收起已关闭",
      );
      await terminalToggle.click();
      assert.equal(await terminalToggle.getAttribute("aria-expanded"), "false");
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
      waitUntil: "load",
    });
    const query = page.getByRole("textbox", {
      name: "搜索频道、私信、消息",
    });
    const imeMarker = `ime-${engine}-${width}-rah-contract`;
    let imeRequests = 0;
    const countImeRequests = (request) => {
      if (
        request.url().endsWith("/v3/client/search") &&
        request.method() === "POST" &&
        request.postDataJSON()?.query === imeMarker
      )
        imeRequests += 1;
    };
    page.on("request", countImeRequests);
    await query.evaluate((element, value) => {
      element.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
      );
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(element, value);
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: value,
          inputType: "insertCompositionText",
          isComposing: true,
        }),
      );
    }, imeMarker);
    await page.waitForTimeout(350);
    assert.equal(
      imeRequests,
      0,
      "Search must not issue a request while an IME composition is active",
    );
    const composedRequest = page.waitForRequest(
      (request) =>
        request.url().endsWith("/v3/client/search") &&
        request.postDataJSON()?.query === imeMarker,
    );
    await query.evaluate(
      (element, value) =>
        element.dispatchEvent(
          new CompositionEvent("compositionend", {
            bubbles: true,
            data: value,
          }),
        ),
      imeMarker,
    );
    await composedRequest;
    page.off("request", countImeRequests);

    const loadingMarker = `loading-${engine}-${width}-rah-contract`;
    const delaySearch = async (route) => {
      if (route.request().postDataJSON()?.query === loadingMarker)
        await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    };
    await page.route("**/v3/client/search", delaySearch);
    await query.fill(loadingMarker);
    const searchSkeleton = page.getByRole("status", { name: "正在搜索" });
    await searchSkeleton.waitFor();
    assert.equal(
      await searchSkeleton.locator(".rah-search-result-skeleton-card").count(),
      5,
      "Raft Search loading uses five bounded result skeletons",
    );
    await page.screenshot({
      path: join(output, `${engine}-search-loading-${width}.png`),
    });
    await searchSkeleton.waitFor({ state: "detached" });
    await page.unroute("**/v3/client/search", delaySearch);

    const failureMarker = `failure-${engine}-${width}-rah-contract`;
    let failOnce = true;
    const failSearchOnce = async (route) => {
      if (route.request().postDataJSON()?.query === failureMarker && failOnce) {
        failOnce = false;
        await route.fulfill({
          body: "{}",
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      await route.continue();
    };
    await page.route("**/v3/client/search", failSearchOnce);
    await query.fill(failureMarker);
    const searchFailure = page.getByRole("alert").filter({
      hasText: "搜索失败",
    });
    await searchFailure.waitFor();
    await page.screenshot({
      path: join(output, `${engine}-search-error-${width}.png`),
    });
    const retriedRequest = page.waitForRequest(
      (request) =>
        request.url().endsWith("/v3/client/search") &&
        request.postDataJSON()?.query === failureMarker,
    );
    await searchFailure
      .getByRole("button", { name: "重试", exact: true })
      .click();
    await retriedRequest;
    await searchFailure.waitFor({ state: "detached" });
    await page.unroute("**/v3/client/search", failSearchOnce);

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
  const messageCandidate = page.locator(".msg:has(.msg-actions)").first();
  await messageCandidate.waitFor();
  const restingActions = messageCandidate.locator(".msg-actions");
  assert.equal(
    await restingActions.evaluate(
      (element) => getComputedStyle(element).opacity,
    ),
    "0",
  );
  await messageCandidate.hover();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".msg:hover .msg-actions")).some(
      (element) => getComputedStyle(element).opacity === "1",
    ),
  );
  const hoveredMessageId = await page
    .locator(".msg:hover[data-message-id]")
    .first()
    .getAttribute("data-message-id");
  assert.ok(hoveredMessageId, "hovered message must expose canonical identity");
  const escapedMessageId = await page.evaluate(
    (messageId) => CSS.escape(messageId),
    hoveredMessageId,
  );
  const message = page
    .locator(`[data-message-id="${escapedMessageId}"]`)
    .first();
  const actions = message.locator(".msg-actions");
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

  await message.hover();
  await actions
    .getByRole("button", { name: "在消息列中回复", exact: true })
    .click();
  const threadPanel = page.getByRole("complementary", { name: "Thread 讨论" });
  await threadPanel.waitFor();
  await threadPanel
    .getByRole("button", { name: "消息列操作", exact: true })
    .click();
  const provisionalUnfollow = threadPanel.getByRole("menuitem", {
    name: "取消关注消息列",
    exact: true,
  });
  await provisionalUnfollow.waitFor();
  const createdThreadFollow = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v3/client/activity/follow") &&
      response.request().method() === "POST",
  );
  await provisionalUnfollow.click();
  assert.equal((await (await createdThreadFollow).json()).following, false);
  await threadPanel
    .getByRole("button", { name: "关闭消息列", exact: true })
    .click();
  await threadPanel.waitFor({ state: "detached" });
  const focusMessageId = await message.getAttribute("data-message-id");
  await page.waitForFunction(
    (messageId) =>
      document.activeElement ===
      document.querySelector(
        `[data-message-id="${CSS.escape(String(messageId))}"]`,
      ),
    focusMessageId,
  );
  assert.equal(
    await message.evaluate((element) => document.activeElement === element),
    true,
    "closing a Thread restores focus to its connected message opener",
  );

  const followerQuery = page.waitForRequest(
    (request) =>
      request.url().endsWith("/v3/client/activity/thread-followers") &&
      request.method() === "POST",
  );
  await message.click({ button: "right" });
  await contextMenu.waitFor();
  const followerInput = (await followerQuery).postDataJSON();
  const contextFollow = contextMenu.getByRole("menuitem", {
    name: "关注消息列",
    exact: true,
  });
  await contextFollow.waitFor();
  await contextFollow.waitFor({ state: "visible" });
  await contextFollow.click({ trial: true });
  assert.equal(await contextFollow.isEnabled(), true);
  await page.screenshot({
    path: join(output, `${engine}-message-thread-follow.png`),
  });
  const contextFollowResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v3/client/activity/follow") &&
      response.request().method() === "POST",
  );
  await contextFollow.click();
  assert.equal((await (await contextFollowResponse).json()).following, true);
  const canonicalFollowers = await postFixture(
    page,
    "/v3/client/activity/thread-followers",
    followerInput,
  );
  assert.equal(
    canonicalFollowers.following,
    true,
    "the message menu must mutate canonical Thread follow state",
  );

  await reactionChip.click();
  await reactionChip.waitFor({ state: "detached" });
  await saved.click();
  await saved.waitFor({ state: "detached" });

  const sentPrefix = `conversation family ${engine} canonical send`;
  const sentBody = `${sentPrefix} ${"bounded long content ".repeat(120)}`;
  await composer.fill(sentBody);
  const sentResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v3/client/messages/post") &&
      response.request().method() === "POST",
  );
  await composer.press("Enter");
  const sentMutation = await (await sentResponse).json();
  assert.equal(sentMutation.event.type, "message.posted");
  // A later Agent reply can quote this prefix. Inspect the accepted Human
  // Message identity, never whichever matching text happens to arrive last.
  const sentMessage = page.locator(
    `.msg[data-message-id=${JSON.stringify(sentMutation.event.aggregateId)}]`,
  );
  await sentMessage.waitFor();
  await sentMessage
    .getByRole("button", { name: "展开全文", exact: true })
    .click();
  await sentMessage.getByRole("button", { name: "收起", exact: true }).click();
  const sentLedger = await postFixture(page, "/v3/client/rooms/sync", {
    afterSeq: 0,
    consumerId: `conversation-send-${engine}`,
    limit: 500,
    roomId: sentMutation.event.roomId,
  });
  assert.ok(
    sentLedger.events.some(
      (event) =>
        event.aggregateId === sentMutation.event.aggregateId &&
        event.type === "message.posted",
    ),
    "the composer result must exist in the canonical Room ledger",
  );

  const taskMatrixRoom = page.locator(
    '.rah-room-sidebar [data-sidebar-key^="room:"]:has-text("Task Matrix") .channel-row',
  );
  await taskMatrixRoom.click();
  const tabs = page.getByRole("tablist", { name: "对话内容", exact: true });
  await tabs.getByRole("tab", { name: "任务", exact: true }).click();
  const roomTask = page.locator(
    '.rah-global-task-card:has-text("Keep the Room-first delivery contract")',
  );
  await roomTask.waitFor();
  assert.equal(
    await roomTask.locator(".kcard-no b").count(),
    0,
    "Room Task cards do not repeat the Room name",
  );
  const roomCreator = page
    .locator('.tasks-toolbar[aria-label="任务筛选与视图"]')
    .getByRole("button", { name: "创建者", exact: true });
  await roomCreator.click();
  const roomCreatorMenu = page.getByRole("menu", { name: "创建者筛选" });
  await roomCreatorMenu.waitFor();
  const roomCreatorSentinel = roomCreatorMenu.getByRole("menuitemradio", {
    name: "我创建的",
    exact: true,
  });
  await roomCreatorSentinel.waitFor();
  assert.equal(
    await roomCreatorSentinel
      .locator(".rah-agent-avatar, .rah-settings-avatar")
      .count(),
    0,
    "a Human-only Room retains the official sentinel without inventing an Agent option",
  );
  await page.keyboard.press("Escape");
  const firstCreatedTitle = `Raft batch ${engine} one`;
  const secondCreatedTitle = `Raft batch ${engine} two`;
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "创建任务" });
  await createDialog.waitFor();
  await createDialog
    .getByRole("textbox", { name: "任务 1", exact: true })
    .fill(firstCreatedTitle);
  await createDialog
    .getByRole("button", { name: "再加一条", exact: true })
    .click();
  await createDialog
    .getByRole("textbox", { name: "任务 2", exact: true })
    .fill(secondCreatedTitle);
  assert.equal(
    await createDialog.getByRole("button", { name: /移除任务/u }).count(),
    2,
  );
  await page.screenshot({
    path: join(output, `${engine}-task-create-dialog-1440.png`),
  });
  const prerequisiteTaskId = await roomTask.evaluate((element) =>
    element.closest("[data-task-id]")?.getAttribute("data-task-id"),
  );
  assert.ok(prerequisiteTaskId);
  await createDialog
    .getByRole("button", { name: "配置协作与依赖", exact: true })
    .click();
  const configuredDialog = page.getByRole("dialog", {
    name: "配置任务协作",
  });
  await configuredDialog.waitFor();
  await configuredDialog.getByText("当前 Room 尚未设置 Agent").waitFor();
  await configuredDialog
    .getByRole("group", { name: "前置任务", exact: true })
    .getByRole("checkbox", {
      name: /Keep the Room-first delivery contract/u,
    })
    .check();
  await page.screenshot({
    path: join(output, `${engine}-task-create-collaboration-1440.png`),
  });
  const createRequests = [];
  let failSecondCreate = true;
  let lostReceiptRequest;
  let lostReceiptTaskId;
  const partialCreateRoute = async (route) => {
    const request = route.request().postDataJSON();
    createRequests.push(request);
    const response = await route.fetch();
    if (
      failSecondCreate &&
      request.title === secondCreatedTitle &&
      response.status() === 200
    ) {
      failSecondCreate = false;
      lostReceiptRequest = structuredClone(request);
      const canonicalAcceptance = await page.request.post(
        route.request().url(),
        {
          data: request,
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
        },
      );
      if (!canonicalAcceptance.ok())
        throw new Error(
          `canonical acceptance replay failed: ${canonicalAcceptance.status()} ${await canonicalAcceptance.text()}`,
        );
      const canonicalBody = await canonicalAcceptance.json();
      assert.equal(canonicalBody.task.title, secondCreatedTitle);
      lostReceiptTaskId = canonicalBody.task.taskId;
      await route.fulfill({
        // The canonical server has accepted the command; only its receipt is
        // lost. Retrying must hit Kernel idempotency rather than create a
        // second Task/event.
        body: "receipt lost after canonical acceptance",
        contentType: "text/plain",
        status: 200,
      });
      return;
    }
    await route.fulfill({ response });
  };
  await page.route("**/v3/client/tasks/create", partialCreateRoute);
  const lostReceiptResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/v3/client/tasks/create" &&
      response.request().postDataJSON()?.title === secondCreatedTitle &&
      response.headers()["content-type"]?.startsWith("text/plain"),
  );
  await configuredDialog
    .getByRole("button", { name: "创建 2 个任务", exact: true })
    .click();
  await configuredDialog
    .getByText(
      /已确认 1 \/ 2；\s*标题与协作配置已冻结，只会重试尚未确认的任务。/u,
    )
    .waitFor();
  // The first accepted row already renders 1/2 while row two is in flight.
  // Only the injected response proves the second server acceptance completed.
  await lostReceiptResponse;
  assert.equal(
    await configuredDialog
      .getByRole("group", { name: "前置任务", exact: true })
      .getByRole("checkbox", {
        name: /Keep the Room-first delivery contract/u,
      })
      .isDisabled(),
    true,
    "an ambiguous partial create freezes the exact submitted dependencies",
  );
  assert.equal(
    await configuredDialog
      .getByRole("button", { name: "返回", exact: true })
      .isDisabled(),
    true,
    "a partial create cannot return to editable titles",
  );
  const afterPartialCreate = await postFixture(page, "/v3/client/tasks/list", {
    roomId: createRequests[0].roomId,
  });
  assert.equal(
    afterPartialCreate.tasks.filter(({ title }) => title === firstCreatedTitle)
      .length,
    1,
  );
  assert.ok(lostReceiptTaskId);
  const acceptedWithoutReceipt = await postFixture(
    page,
    "/v3/client/tasks/get",
    { roomId: lostReceiptRequest.roomId, taskId: lostReceiptTaskId },
  );
  assert.equal(
    acceptedWithoutReceipt.task.title,
    secondCreatedTitle,
    "the second Task is canonical even though its success receipt was lost",
  );
  await configuredDialog
    .getByRole("button", { name: "重试剩余 1 个任务", exact: true })
    .click();
  await configuredDialog.waitFor({ state: "detached" });
  await page.unroute("**/v3/client/tasks/create", partialCreateRoute);
  assert.ok(lostReceiptRequest);
  assert.deepEqual(
    createRequests.at(-1),
    lostReceiptRequest,
    "an ambiguous row is replayed with the exact original causal command",
  );
  assert.notEqual(
    createRequests[0].idempotencyKey,
    createRequests.at(-1).idempotencyKey,
    "the confirmed first row is not submitted again",
  );
  await page
    .locator(
      `.rah-global-task-card:has-text(${JSON.stringify(firstCreatedTitle)})`,
    )
    .waitFor();
  await page
    .locator(
      `.rah-global-task-card:has-text(${JSON.stringify(secondCreatedTitle)})`,
    )
    .waitFor();
  const roomId = await roomTask.evaluate(
    (element) => element.parentElement?.dataset.taskRoomId,
  );
  assert.ok(roomId);
  const createdList = await postFixture(page, "/v3/client/tasks/list", {
    roomId,
  });
  const createdTasks = createdList.tasks.filter((task) =>
    [firstCreatedTitle, secondCreatedTitle].includes(task.title),
  );
  assert.equal(createdTasks.length, 2);
  for (const task of createdTasks)
    assert.deepEqual(
      task.dependencyTaskIds,
      [prerequisiteTaskId],
      "the optional collaboration step must persist dependencies in the canonical Task",
    );
  const createdLedger = await postFixture(page, "/v3/client/rooms/sync", {
    afterSeq: 0,
    consumerId: `task-page-create-${engine}`,
    limit: 500,
    roomId,
  });
  for (const task of createdTasks)
    assert.equal(
      createdLedger.events.filter(
        (event) =>
          event.aggregateId === task.taskId && event.type === "task.created",
      ).length,
      1,
      `${task.title} must have exactly one canonical task.created event`,
    );
  const roomTaskNumber = Number(
    (await roomTask.locator(".kcard-no span").innerText()).replace("#", ""),
  );
  await tabs.getByRole("tab", { name: "聊天", exact: true }).click();
  const linkedTaskMessage = page.locator(
    `.msg:has(button[aria-label^="打开任务 #${roomTaskNumber}："])`,
  );
  await linkedTaskMessage.waitFor();
  await linkedTaskMessage.click({ button: "right" });
  const linkedTaskMenu = page.locator(".rah-message-context-menu");
  await linkedTaskMenu.waitFor();
  const protectedCompletion = linkedTaskMenu.getByRole("menuitem", {
    name: "标记为完成",
    exact: true,
  });
  assert.equal(
    await protectedCompletion.isDisabled(),
    true,
    "a Raft-labelled message action cannot bypass canonical submission and Review",
  );
  assert.equal(
    await protectedCompletion.getAttribute("title"),
    "只有已提交且满足审阅要求的任务才能完成",
  );
  await page.screenshot({
    path: join(output, `${engine}-message-task-protected.png`),
  });
  await page.keyboard.press("Escape");
  await tabs.getByRole("tab", { name: "任务", exact: true }).click();
  const roomList = page.getByRole("radio", { name: "列表", exact: true });
  await roomList.click();
  assert.equal(await roomList.getAttribute("aria-checked"), "true");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  await page.screenshot({
    path: join(output, `${engine}-room-task-family-390.png`),
  });

  const activePageSeed = createdTasks[0];
  assert.ok(activePageSeed);
  const oldestActiveTitle = `Room active continuation ${engine} #1`;
  const activeTaskPage = Array.from({ length: 500 }, (_, offset) => {
    const taskNumber = offset + 502;
    return {
      ...activePageSeed,
      dependencyTaskIds: [],
      sourceMessageId: `message-active-page-${engine}-${String(taskNumber)}`,
      state: "todo",
      taskId: `task-active-page-${engine}-${String(taskNumber)}`,
      taskNumber,
      threadId: `thread-active-page-${engine}-${String(taskNumber)}`,
      title: `Room active continuation ${engine} #${String(taskNumber)}`,
      workflowStatus: "todo",
    };
  });
  let earlierTaskState = "todo";
  let earlierTaskRevision = 0;
  const earlierActiveTaskPage = Array.from({ length: 500 }, (_, offset) => {
    const taskNumber = offset + 2;
    return {
      ...activePageSeed,
      dependencyTaskIds: [],
      sourceMessageId: `message-active-page-${engine}-${String(taskNumber)}`,
      state: taskNumber === 2 ? earlierTaskState : "todo",
      taskId: `task-active-page-${engine}-${String(taskNumber)}`,
      taskNumber,
      threadId: `thread-active-page-${engine}-${String(taskNumber)}`,
      title: `Room active continuation ${engine} #${String(taskNumber)}`,
      updatedAt: `2026-09-06T00:00:${String(earlierTaskRevision).padStart(2, "0")}.000Z`,
      workflowStatus:
        taskNumber === 2 && earlierTaskState === "blocked"
          ? "in_progress"
          : "todo",
    };
  });
  const oldestActiveTask = {
    ...activePageSeed,
    dependencyTaskIds: [],
    sourceMessageId: `message-active-page-${engine}-1`,
    state: "todo",
    taskId: `task-active-page-${engine}-1`,
    taskNumber: 1,
    threadId: `thread-active-page-${engine}-1`,
    title: oldestActiveTitle,
    workflowStatus: "todo",
  };
  const activeTaskRequests = [];
  const pagedActiveTasks = async (route) => {
    const request = route.request().postDataJSON();
    if (!Array.isArray(request.states)) {
      await route.continue();
      return;
    }
    activeTaskRequests.push(request);
    await route.fulfill({
      json:
        request.beforeTaskNumber === 2
          ? { tasks: [oldestActiveTask] }
          : request.beforeTaskNumber === 502
            ? {
                nextBeforeTaskNumber: 2,
                tasks: earlierActiveTaskPage.map((task) =>
                  task.taskNumber === 2
                    ? {
                        ...task,
                        ...(earlierTaskState === "blocked"
                          ? {
                              assigneeId: "agent-fixture-refresh",
                              blockedAt: "2026-09-06T00:00:01.000Z",
                              blockedReason: "fixture state refresh",
                            }
                          : {}),
                        state: earlierTaskState,
                        updatedAt: `2026-09-06T00:00:${String(earlierTaskRevision).padStart(2, "0")}.000Z`,
                        workflowStatus:
                          earlierTaskState === "blocked"
                            ? "in_progress"
                            : "todo",
                      }
                    : task,
                ),
              }
            : { nextBeforeTaskNumber: 502, tasks: activeTaskPage },
      status: 200,
    });
  };
  await page.route("**/v3/client/tasks/list", pagedActiveTasks);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload({ waitUntil: "load" });
  const loadEarlierTasks = page.getByRole("button", {
    name: "载入更早任务",
    exact: true,
  });
  await loadEarlierTasks.waitFor();
  await loadEarlierTasks.click();
  const earlierTask = page.locator(
    `[data-task-id="task-active-page-${engine}-2"]`,
  );
  const scrollTasksTo = async (end) => {
    await scrollTaskWindow(page, end ? "end" : "start");
  };
  await page.waitForFunction(() =>
    [...document.querySelectorAll("[data-total-count]")].some(
      (row) => Number(row.getAttribute("data-total-count")) >= 1000,
    ),
  );
  await scrollTasksTo(true);
  await earlierTask.waitFor();
  assert.ok(
    (await page.locator("[data-task-id]").count()) <= 80,
    "loaded Task pages must not mount the entire history",
  );
  assert.ok(
    activeTaskRequests.some(
      ({ beforeTaskNumber, limit }) =>
        beforeTaskNumber === 502 && limit === 500,
    ),
    "the Room Task continuation must request the next bounded active page",
  );
  const pollingDeadline = Date.now() + 18_000;
  while (
    (activeTaskRequests.filter(
      ({ beforeTaskNumber }) => beforeTaskNumber === undefined,
    ).length < 3 ||
      activeTaskRequests.filter(
        ({ beforeTaskNumber }) => beforeTaskNumber === 502,
      ).length < 3) &&
    Date.now() < pollingDeadline
  )
    await page.waitForTimeout(250);
  assert.ok(
    activeTaskRequests.filter(
      ({ beforeTaskNumber }) => beforeTaskNumber === undefined,
    ).length >= 3,
    "the fixture must observe two ordinary Room polling cycles",
  );
  assert.ok(
    activeTaskRequests.filter(
      ({ beforeTaskNumber }) => beforeTaskNumber === 502,
    ).length >= 3,
    "each polling cycle must re-read the visited older page",
  );
  await earlierTask.waitFor();
  earlierTaskState = "blocked";
  earlierTaskRevision += 1;
  const refreshCount = activeTaskRequests.filter(
    ({ beforeTaskNumber }) => beforeTaskNumber === 502,
  ).length;
  const refreshDeadline = Date.now() + 8_000;
  while (
    activeTaskRequests.filter(
      ({ beforeTaskNumber }) => beforeTaskNumber === 502,
    ).length <= refreshCount &&
    Date.now() < refreshDeadline
  )
    await page.waitForTimeout(250);
  await scrollTasksTo(false);
  await page.waitForFunction(
    (taskId) =>
      document
        .querySelector(`[data-task-id="${taskId}"]`)
        ?.querySelector("[data-task-workflow-status]")
        ?.getAttribute("data-task-workflow-status") === "in-progress",
    `task-active-page-${engine}-2`,
  );
  await loadEarlierTasks.click();
  await scrollTasksTo(true);
  await page.locator(`[data-task-id="task-active-page-${engine}-1"]`).waitFor();
  assert.ok(
    activeTaskRequests.some(
      ({ beforeTaskNumber, limit }) => beforeTaskNumber === 2 && limit === 500,
    ),
    "the continuation must advance after repeated polling",
  );
  await page.screenshot({
    path: join(output, `${engine}-room-task-active-continuation-1440.png`),
  });
  await page.unroute("**/v3/client/tasks/list", pagedActiveTasks);
}
