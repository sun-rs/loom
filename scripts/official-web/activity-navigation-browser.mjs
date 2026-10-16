import assert from "node:assert/strict";
export async function verifyActivityNavigation({
  browser,
  origin,
  client,
  workspace,
  head,
  instances,
  role,
}) {
  const { room } = await client.request("room.create", {
    workspaceId: workspace.workspaceId,
    basedOnControlRoomSeq: await head(workspace.controlRoomId),
    kind: "channel",
    name: "FIXTURE activity navigation",
    slug: "fixture-activity-navigation",
    idempotencyKey: "activity-navigation-room",
  });
  const member = await client.request("role.instantiate", {
    roleId: role.roleId,
    channelId: room.roomId,
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: "navigation-member",
  });
  await client.request("agent.manage", {
    action: "set_state",
    agentId: member.instance.agentId,
    state: "disabled",
    basedOnRoomSeq: await head(workspace.controlRoomId),
    idempotencyKey: "navigation-member-disable",
  });
  const post = async (n) =>
    client.request("message.post", {
      roomId: room.roomId,
      body: `FIXTURE navigation ${n}`,
      recipients: [],
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: `activity-navigation-${n}`,
    });
  await post("target");
  const snapshot = await client.request("activity.list", {
    workspaceId: workspace.workspaceId,
    limit: 20,
  });
  const card = snapshot.items.find((i) => i.roomId === room.roomId);
  assert.ok(card);
  for (let n = 0; n < 65; n++) await post(n);
  const { thread } = await client.request("thread.create", {
    roomId: room.roomId,
    rootMessageId: card.latestMessage.messageId,
    recipientIds: [],
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: "activity-thread",
  });
  const reply = async (n) =>
    client.request("thread.reply", {
      roomId: room.roomId,
      threadId: thread.threadId,
      body: `FIXTURE reply navigation ${n}`,
      recipientIds: [],
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: `activity-reply-${n}`,
    });
  await reply("target");
  await client.request("activity.follow", {
    roomId: room.roomId,
    threadId: thread.threadId,
    following: true,
  });
  const threadSnapshot = await client.request("activity.list", {
    workspaceId: workspace.workspaceId,
    limit: 20,
  });
  const threadCard = threadSnapshot.items.find(
    (i) => i.threadId === thread.threadId,
  );
  assert.ok(threadCard);
  for (let n = 0; n < 60; n++) await reply(n);
  await client.request("agent.manage", {
    action: "set_state",
    agentId: instances[0].agentId,
    state: "disabled",
    basedOnRoomSeq: await head(workspace.controlRoomId),
    idempotencyKey: "activity-direct-disable",
  });
  const { room: direct } = await client.request("room.direct.open", {
    workspaceId: workspace.workspaceId,
    peerPrincipalId: instances[0].instanceId,
    basedOnControlRoomSeq: await head(workspace.controlRoomId),
    idempotencyKey: "activity-direct",
  });
  await client.request("message.post", {
    roomId: direct.roomId,
    body: "FIXTURE private navigation target",
    recipients: [],
    basedOnRoomSeq: await head(direct.roomId),
    idempotencyKey: "activity-direct-target",
  });
  const directSnapshot = await client.request("activity.list", {
    workspaceId: workspace.workspaceId,
    limit: 20,
  });
  const directCard = directSnapshot.items.find(
    (i) => i.roomId === direct.roomId,
  );
  assert.ok(directCard);
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      // UI-only agent author projection over temporary Core reads; never impersonate a Worker or mutate authored history.
      for (const endpoint of ["context", "list"])
        await page.route(`**/v3/client/messages/${endpoint}`, async (route) => {
          const response = await route.fetch();
          const data = await response.json();
          for (const message of [
            data.message,
            data.rootMessage,
            ...(data.messages ?? []),
          ]) {
            if (message?.roomId === room.roomId)
              message.actorId = member.instance.instanceId;
          }
          await route.fulfill({ response, json: data });
        });

      await page.goto(origin + "/?view=search");
      await page.getByLabel("搜索内容", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "搜索消息", exact: true })
          .count(),
        0,
        "Native search has a header input, not a separate submit form",
      );
      const searchInput = page.getByLabel("搜索内容", { exact: true });
      await searchInput.fill("target");
      await page.waitForURL((u) => u.searchParams.get("q") === "target");
      await page
        .locator(`[data-result-id="${card.latestMessage.messageId}"]`)
        .waitFor();
      await page.getByLabel("范围", { exact: true }).click();
      const agentFilterRequest = page.waitForRequest(
        (r) =>
          r.url().endsWith("/v3/client/search") &&
          r.postDataJSON().senderKind === "agent",
      );
      await page.getByRole("option", { name: "Agent", exact: true }).click();
      await agentFilterRequest;
      await page.keyboard.press("Escape");
      await page.getByLabel("时间", { exact: true }).click();
      const timeRequest = page.waitForRequest(
        (r) =>
          r.url().endsWith("/v3/client/search") && !!r.postDataJSON().after,
      );
      await page
        .getByRole("option", { name: "最近 7 天", exact: true })
        .click();
      await timeRequest;
      await page.goto(origin + "/?view=search&q=target");
      await searchInput.waitFor();
      await page.getByLabel("发送者", { exact: true }).click();
      const senderRequest = page.waitForRequest(
        (r) =>
          r.url().endsWith("/v3/client/search") &&
          r.postDataJSON().senderIds?.length === 1,
      );
      await page.getByRole("option", { name: "我", exact: true }).click();
      const senderBody = (await senderRequest).postDataJSON();
      assert.equal(
        senderBody.senderIds[0],
        (await client.request("principal.me", {})).principal.principalId,
      );
      await page.keyboard.press("Escape");
      await page.getByLabel("打开频道筛选", { exact: true }).click();
      const channelRequest = page.waitForRequest(
        (r) =>
          r.url().endsWith("/v3/client/search") &&
          r.postDataJSON().roomIds?.[0] === room.roomId,
      );
      await page
        .getByRole("option", {
          name: "#FIXTURE activity navigation",
          exact: true,
        })
        .click();
      await channelRequest;
      await page.keyboard.press("Escape");
      await page
        .locator(`[data-result-id="${card.latestMessage.messageId}"]`)
        .click();
      await page.waitForURL((u) => u.searchParams.has("message"));
      assert.equal(
        new URL(page.url()).searchParams.get("channelId"),
        room.roomId,
      );
      assert.equal(
        new URL(page.url()).searchParams.get("senderId"),
        senderBody.senderIds[0],
      );
      await page.goto(
        origin + "/?view=search&q=reply%20navigation&sort=recent",
      );
      const group = page.getByTestId("search-thread-group");
      await group.waitFor();
      assert.equal(await group.count(), 1);
      const groupedPage = await client.request("search", {
        workspaceId: workspace.workspaceId,
        query: "reply navigation",
        sort: "recent",
        scope: "all",
        limit: 20,
      });
      const expectedReplies = groupedPage.hits
        .filter(
          (hit) =>
            hit.message.threadId === thread.threadId && hit.rootMessageId,
        )
        .map((hit) => hit.message.messageId);
      assert.ok(expectedReplies.length > 1);
      assert.deepEqual(
        await group
          .locator("[data-result-id]")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("data-result-id")),
          ),
        expectedReplies,
      );
      assert.equal(
        await page.locator("[data-result-id]").count(),
        groupedPage.hits.length,
      );
      const firstIds = groupedPage.hits.map((hit) => hit.message.messageId);
      if (width === 1440) {
        const failMore = async (route) => {
          if (route.request().postDataJSON().cursor)
            return route.abort("failed");
          return route.continue();
        };
        await page.route("**/v3/client/search", failMore);
        await page
          .getByRole("button", { name: "加载更多", exact: true })
          .click({ timeout: 3000 });
        await page
          .getByRole("alert")
          .filter({ hasText: "无法加载更多结果。" })
          .waitFor();
        assert.equal(await page.locator("[data-result-id]").count(), 20);
        await page.unroute("**/v3/client/search", failMore);
        await page.getByRole("button", { name: "重试", exact: true }).click();
      } else {
        await page
          .getByRole("button", { name: "加载更多", exact: true })
          .click({ timeout: 3000 });
      }
      await page.waitForFunction(
        () => document.querySelectorAll("[data-result-id]").length === 40,
      );
      const secondPage = await client.request("search", {
        workspaceId: workspace.workspaceId,
        query: "reply navigation",
        sort: "recent",
        scope: "all",
        limit: 20,
        cursor: groupedPage.nextCursor,
      });
      assert.deepEqual(
        new Set(
          await page
            .locator("[data-result-id]")
            .evaluateAll((nodes) =>
              nodes.map((n) => n.getAttribute("data-result-id")),
            ),
        ),
        new Set([
          ...firstIds,
          ...secondPage.hits.map((hit) => hit.message.messageId),
        ]),
      );
      await searchInput.focus();
      await searchInput.press("ArrowDown");
      await searchInput.press("Enter");
      await page.waitForURL(
        (u) => u.searchParams.get("message") === firstIds[1],
      );
      await page.goto(origin + "/?view=search&q=target");
      await searchInput.waitFor();
      await searchInput.dispatchEvent("compositionstart");
      await searchInput.fill("未完成输入");
      assert.equal(new URL(page.url()).searchParams.get("q"), "target");
      await searchInput.dispatchEvent("compositionend", { data: "未完成输入" });
      await page.waitForURL((u) => u.searchParams.get("q") === "未完成输入");
      await page.getByRole("button", { name: "清除搜索", exact: true }).click();
      await page.waitForURL((u) => !u.searchParams.has("q"));
      if (width === 390) {
        assert.equal(
          await page
            .locator('[role="navigation"][aria-label="主导航"]:visible')
            .count(),
          0,
        );
        await page
          .getByRole("button", { name: "返回聊天列表", exact: true })
          .click();
        await page.waitForURL((u) => u.searchParams.get("chat") === "list");
        await page.goto(origin + "/?view=activity");
        assert.equal(
          await page
            .locator('[role="navigation"][aria-label="主导航"]:visible')
            .count(),
          0,
        );
        await page
          .getByRole("button", { name: "返回聊天列表", exact: true })
          .click();
        await page.waitForURL((u) => u.searchParams.get("chat") === "list");
      }
      // Real temporary Core: Done consumes only this activity frontier; new messages reopen it.
      await post(`done-before-${width}`);
      await page.goto(origin + "/?view=activity");
      const doneRow = page.locator(`[data-result-id="${card.key}"]`);
      await doneRow.waitFor();
      await doneRow.hover();
      const marks = [];
      const captureMark = (request) => {
        if (request.url().endsWith("/v3/client/activity/mark"))
          marks.push(request.postDataJSON());
      };
      page.on("request", captureMark);
      const beforeDone = await client.request("activity.list", {
        workspaceId: workspace.workspaceId,
        limit: 20,
      });
      const frontier = beforeDone.items.find(
        (item) => item.key === card.key,
      ).latestSeq;
      const done = doneRow.getByTestId("inbox-row-done");
      if (width === 1440) {
        await done.focus();
        await done.press("Enter");
      } else await done.click();
      await doneRow.waitFor({ state: "detached" });
      assert.equal(new URL(page.url()).searchParams.has("message"), false);
      assert.deepEqual(marks, [
        { roomId: room.roomId, throughSeq: frontier, action: "done" },
      ]);
      await post(`done-after-${width}`);
      await page.reload();
      await doneRow.waitFor();
      if (width === 1440) {
        await page.route("**/v3/client/activity/mark", (route) =>
          route.abort("failed"),
        );
        await doneRow.hover();
        await doneRow.getByTestId("inbox-row-done").click();
        await page
          .getByRole("alert")
          .filter({ hasText: "不会自动重发操作" })
          .waitFor();
        await doneRow.waitFor();
        assert.equal(
          marks.length,
          2,
          "unknown result must never resend the mutation",
        );
        await page.unroute("**/v3/client/activity/mark");
      }
      page.off("request", captureMark);
      let visibleSnapshot = snapshot;
      await page.route("**/v3/client/activity/list", (route) =>
        route.fulfill({ json: visibleSnapshot }),
      );
      await page.goto(origin + "/?view=activity");
      await page.locator(`[data-result-id="${card.key}"]`).click();
      const highlighted = page.locator(
        `[data-timeline-message-id="${card.latestMessage.messageId}"] [data-highlighted="true"]`,
      );
      await highlighted.waitFor({ timeout: 8000 });
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.equal(
        new URL(page.url()).searchParams.get("message"),
        card.latestMessage.messageId,
      );
      assert.equal(
        new URL(page.url()).searchParams.get("view"),
        width === 1440 ? "activity" : null,
      );
      const box = await highlighted.boundingBox();
      assert.ok(
        box.y >= 0 && box.y + box.height <= (width === 390 ? 844 : 1000),
      );
      assert.ok(
        await highlighted.evaluate((el) =>
          el.className.includes("bg-brutal-cyan/25"),
        ),
      );
      await page.reload();
      await highlighted.waitFor();
      await page.screenshot({
        path: `/tmp/loom-activity-channel-${width}.png`,
      });
      if (width === 1440) {
        const handle = page.getByTestId("activity-detail-resize");
        const before = await handle.boundingBox();
        await page.mouse.move(before.x + before.width / 2, before.y + 80);
        await page.mouse.down();
        await page.mouse.move(before.x + before.width / 2 + 40, before.y + 80, {
          steps: 5,
        });
        await page.mouse.up();
        const after = await handle.boundingBox();
        assert.ok(after.x > before.x + 25);

        await page.locator(`[data-result-id="${card.key}"]`).dblclick();
        await page.waitForURL((u) => !u.searchParams.has("view"));
        await highlighted.waitFor();
      }
      visibleSnapshot = threadSnapshot;
      await page.goto(origin + "/?view=activity");
      await page.locator(`[data-result-id="${threadCard.key}"]`).click();
      const replyTarget = page.locator(
        `[data-timeline-message-id="${threadCard.latestMessage.messageId}"] [data-highlighted="true"]`,
      );
      await replyTarget.waitFor();
      if (width === 1440) {
        assert.equal(
          await page.getByTestId("loom-thread-resizer").count(),
          0,
          "Direct activity thread occupies the primary detail slot, not a third pane",
        );
      }
      assert.equal(
        new URL(page.url()).searchParams.get("thread"),
        card.latestMessage.messageId,
      );
      assert.equal(await page.getByRole("dialog").count(), 0);
      await page.reload();
      await replyTarget.waitFor();
      if (width === 1440) {
        assert.equal(
          await page.getByTestId("activity-thread-content").count(),
          1,
        );
        assert.equal(await page.getByTestId("thread-side-column").count(), 0);
        assert.equal(await page.getByTestId("composer-textarea").count(), 1);
        const detailBox = await page
          .getByTestId("activity-thread-content")
          .boundingBox();
        assert.ok(
          detailBox.width > 500,
          "Primary thread uses remaining detail width",
        );
      }
      const replyBox = await replyTarget.boundingBox();
      assert.ok(replyBox.y >= 0 && replyBox.y < (width === 390 ? 844 : 1000));
      await page.screenshot({ path: `/tmp/loom-activity-thread-${width}.png` });
      await page
        .getByTestId(width === 1440 ? "thread-close" : "thread-mobile-back")
        .click();
      await page.waitForURL(
        (u) => !u.searchParams.has("thread") && !u.searchParams.has("message"),
      );
      assert.equal(
        await page.getByText("Message focus scope mismatch").count(),
        0,
      );
      if (width === 1440) {
        assert.equal(new URL(page.url()).searchParams.has("room"), false);
        await page
          .getByTestId("activity-thread-content")
          .waitFor({ state: "detached" });
        assert.equal(
          await page.getByTestId("activity-thread-content").count(),
          0,
        );
        // A channel detail with a nested thread still has the official third pane.
        await page.goto(
          origin +
            `/?view=activity&room=${room.roomId}&thread=${card.latestMessage.messageId}`,
        );
        await page.getByTestId("loom-thread-resizer").waitFor();
        assert.equal(
          await page.getByTestId("activity-thread-content").count(),
          0,
        );
        await page.locator(`[data-result-id="${card.key}"]`).click();
        await page.waitForURL((u) => !u.searchParams.has("thread"));
        const channelTarget = threadSnapshot.items.find(
          (i) => i.key === card.key,
        ).latestMessage.messageId;
        await page
          .locator(
            `[data-timeline-message-id="${channelTarget}"] [data-highlighted="true"]`,
          )
          .waitFor();
        assert.equal(await page.getByTestId("thread-side-column").count(), 0);
      }
      visibleSnapshot = directSnapshot;
      await page.goto(origin + "/?view=activity");
      await page.locator(`[data-result-id="${directCard.key}"]`).click();
      await page
        .locator(
          `[data-timeline-message-id="${directCard.latestMessage.messageId}"] [data-highlighted="true"]`,
        )
        .waitFor();
      assert.equal(new URL(page.url()).searchParams.get("room"), direct.roomId);
      assert.equal(new URL(page.url()).searchParams.has("thread"), false);
      await page.goBack();
      await page.getByTestId("inbox-row").first().waitFor();
      assert.equal(new URL(page.url()).searchParams.get("view"), "activity");
      if (width === 1440) {
        await page.goto(
          origin +
            `/?room=${room.roomId}&thread=${card.latestMessage.messageId}`,
        );
        const threadPane = page.getByTestId("thread-side-column");
        const draft = threadPane.getByTestId("composer-textarea");
        await draft.fill("FIXTURE retained thread draft");
        await page.getByRole("button", { name: "频道成员与状态" }).click();
        await page
          .getByTestId("loom-channel-members")
          .getByText(member.agent.displayName ?? member.agent.handle, {
            exact: true,
          })
          .click();
        await page.getByTestId("profile-panel").waitFor({ timeout: 5000 });
        assert.equal(
          await threadPane.count(),
          1,
          "Opening profile retains thread state",
        );
        assert.equal(
          await threadPane.isVisible(),
          false,
          "Channel-sourced profile folds thread",
        );
        await page
          .getByTestId("loom-members-dialog")
          .waitFor({ state: "detached" });
        await page.keyboard.press("Escape");
        await page.getByTestId("profile-panel").waitFor({ state: "detached" });
        await draft.waitFor();
        assert.equal(await draft.inputValue(), "FIXTURE retained thread draft");
        assert.equal(
          new URL(page.url()).searchParams.get("thread"),
          card.latestMessage.messageId,
        );
        await threadPane.getByTestId("thread-parent-avatar").click();
        await page.getByTestId("profile-panel").waitFor();
        assert.equal(
          await threadPane.isVisible(),
          true,
          "Thread-sourced profile retains the thread",
        );
        assert.equal(
          await page.locator(".thread-main-column").isVisible(),
          false,
          "Thread-sourced profile folds the channel",
        );
        await page.keyboard.press("Escape");
        await page.getByTestId("profile-panel").waitFor({ state: "detached" });
        await draft.waitFor();
        assert.equal(await draft.inputValue(), "FIXTURE retained thread draft");
      }
      // Search uses the same primary slot, including direct thread hits.
      for (const [query, target, isThread] of [
        ["target", card.latestMessage.messageId, false],
        ["target", threadCard.latestMessage.messageId, true],
      ]) {
        await page.goto(
          origin + `/?view=search&q=${encodeURIComponent(query)}`,
        );
        await page.locator(`[data-result-id="${target}"]`).click();
        const focused = page.locator(
          `[data-timeline-message-id="${target}"] [data-highlighted="true"]`,
        );
        await focused.waitFor({ timeout: 5000 });
        assert.equal(await page.getByRole("dialog").count(), 0);
        assert.equal(new URL(page.url()).searchParams.get("view"), "search");
        if (isThread) {
          const threadPane = page.getByTestId("activity-thread-content");
          assert.equal(await threadPane.count(), 1);
          const draft = threadPane.getByTestId("composer-textarea");
          await draft.fill("FIXTURE primary thread draft");
          await threadPane.getByTestId("thread-parent-avatar").click();
          await page.getByTestId("profile-panel").waitFor({ timeout: 5000 });
          await page
            .getByRole("button", {
              name: width === 1440 ? "关闭实例详情" : "返回聊天",
              exact: true,
            })
            .click();
          await page
            .getByTestId("profile-panel")
            .waitFor({ state: "detached" });
          await draft.waitFor();
          assert.equal(
            await draft.inputValue(),
            "FIXTURE primary thread draft",
          );
        }
        if (width === 1440) {
          const url = page.url();
          for (const size of [900, 390, 1440]) {
            await page.setViewportSize({
              width: size,
              height: size === 390 ? 844 : 1000,
            });
            await focused.waitFor();
            assert.equal(
              page.url(),
              url,
              "Resizing preserves route and selected detail",
            );
            assert.equal(
              await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
              ),
              false,
            );
          }
          await page.locator(`[data-result-id="${target}"]`).dblclick();
          await page.waitForURL((u) => !u.searchParams.has("view"));
          await focused.waitFor();
          await page.goBack();
          await focused.waitFor();
        }
      }
      assert.deepEqual(errors, []);
      await page.screenshot({
        path: `/tmp/loom-activity-navigation-${width}.png`,
      });
      results.push({
        width,
        activityDoneExactFrontierAndReopen: true,
        oldMessageLocated: true,
        oldThreadReplyLocated: true,
        directThreadUsesPrimarySlot: width === 1440,
        nestedThreadKeepsSidePane: width === 1440,
        privateMessageLocated: true,
        backRestoresActivity: true,
        threadCloseClearsReplyTarget: true,
        desktopDividerDraggable: width === 1440,
        searchPrimarySlotsAndResize: true,
        nativeSearchHeaderCompositionAndFilters: true,
        nativeSenderChannelAndThreadGroups: true,
        nativeLoadMoreAndKeyboard: true,
        mobileNavigationAndReturn: width === 390,
        threadParentOpensProfilePreservingDraft: true,
        channelThreadProfileDraftPreserved: width === 1440,
        nativeHighlight: true,
        noContextDialog: true,
        refreshRestores: true,
        desktopDetailAndDoubleClick: width === 1440,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
