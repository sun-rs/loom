import { verifySaved } from "./saved-browser.mjs";
import { verifyReactions } from "./reactions-browser.mjs";
import { verifyLocalFonts } from "./local-fonts-browser.mjs";
import { verifyNotifications } from "./notifications-browser.mjs";
import { verifyThreadFollowers } from "./thread-followers-browser.mjs";
import { verifyAbout } from "./about-browser.mjs";
import { verifyTaskBoard } from "./task-board-browser.mjs";
import { verifyAccountSettings } from "./account-settings-browser.mjs";
import { verifySystemSettings } from "./system-settings-browser.mjs";
import { verifySettingsArchive } from "./settings-archive-browser.mjs";
import { verifyTaskCreate } from "./task-create-browser.mjs";
import { verifyAttachmentPreview } from "./attachment-preview-browser.mjs";
import { verifySearchHistory } from "./search-history-browser.mjs";
import { verifyActivityReturn } from "./activity-return-browser.mjs";
import { verifySearchRecent } from "./search-recent-browser.mjs";
import { verifySearchEntities } from "./search-entities-browser.mjs";
import { verifyLayout } from "./layout-browser.mjs";
import { verifyTopbar, openFullSearch } from "./topbar-browser.mjs";
import { verifyAppearance } from "./appearance-browser.mjs";
import { verifyActivityNavigation } from "./activity-navigation-browser.mjs";
import { verifyAttachmentDetails } from "./attachment-details-browser.mjs";
import { verifyAttachments } from "./attachments-browser.mjs";
import { verifyTaskManagement } from "./task-management-browser.mjs";
import { verifyChannelTasks } from "./channel-task-browser.mjs";
import { verifyTasks } from "./task-browser.mjs";
import { verifyThreads } from "./thread-browser.mjs";
import { verifySettingsNavigation } from "./settings-navigation-browser.mjs";
import { verifyChannelControls } from "./channel-controls-browser.mjs";
import { verifyMentions } from "./mentions-browser.mjs";
import { verifySystemNotices } from "./system-notices-browser.mjs";
import {
  verifyMobileChatNavigation,
  showChatList,
  openChatRow,
} from "./mobile-chat-browser.mjs";
import { verifyChatBootstrap } from "./chat-rules-browser.mjs";
import { verifySidebarActions } from "./sidebar-actions-browser.mjs";
import { verifyDiscovery } from "./discovery-browser.mjs";
import { verifyManagement } from "./management-browser.mjs";
import { verifyGlobalNavigation } from "./navigation-browser.mjs";
import { verifyInstanceCreation } from "./instance-browser.mjs";
import { verifyPrivateBoxes } from "./private-browser.mjs";
import { assertSparseHistoryStartsAtTop } from "./history-layout.mjs";
// FIXTURE ONLY: real temporary Loom Core/gateway, no provider execution or user data.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { HttpRahClient } from "@rah-os/client-sdk";
import { startRestartableLocalCoreWorkbench } from "../../packages/daemon/src/restartable-local-workbench.ts";
const directory = mkdtempSync(join(tmpdir(), "loom-official-channel-"));
const bin = join(directory, "bin");
const cwd = join(directory, "workspace");
mkdirSync(bin);
mkdirSync(cwd);
writeFileSync(
  join(bin, "codex"),
  `#!${process.execPath}\nconst args=process.argv.slice(2).join(' ');if(args==='--version') console.log('FAKE discovery only');else if(args==='debug models --bundled') console.log(JSON.stringify({models:[{slug:"gpt-members-fixture",visibility:"list",supported_in_api:true,supported_reasoning_levels:[{effort:"low"}],service_tiers:[]}]}));else process.exitCode=2;\n`,
  { mode: 0o700 },
);
let running;
let browser;
const results = [];
try {
  running = await startRestartableLocalCoreWorkbench({
    environment: { ...process.env, PATH: bin },
    mode: process.env.LOOM_BROWSER_TRUSTED_HOST
      ? {
          kind: "tailnet",
          bindHost: process.env.LOOM_BROWSER_TRUSTED_HOST,
          additionalBindHosts: ["127.0.0.1"],
          port: 0,
        }
      : { kind: "loopback", port: 0 },
    staticDirectory: resolve(
      process.env.LOOM_BROWSER_STATIC_DIRECTORY ??
        "frontends/raft/packages/web/dist-workbench",
    ),
    workbenchHome: join(directory, "home"),
    workspaceCwd: cwd,
  });
  const origin = running.descriptor.webOrigin;
  const response = await fetch(origin);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  const client = new HttpRahClient({
    baseUrl: origin,
    accessToken: () => "trusted-proxy-auth",
    fetch: (url, init) =>
      fetch(url, { ...init, headers: { ...init.headers, cookie, origin } }),
  });
  const workspace = (await client.request("workspace.list", {})).workspaces[0];
  const head = async (roomId) =>
    (
      await client.request("room.sync", {
        roomId,
        consumerId: "browser-fixture",
      })
    ).latestRoomSeq;
  const channels = [];
  for (const name of ["FIXTURE Alpha", "FIXTURE Beta", "FIXTURE Members"]) {
    const result = await client.request("room.create", {
      workspaceId: workspace.workspaceId,
      basedOnControlRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: name,
      kind: "channel",
      name,
      slug: name.toLowerCase().replaceAll(" ", "-"),
    });
    channels.push(result.room);
  }
  for (let i = 1; i <= 55; i++)
    await client.request("message.post", {
      roomId: channels[0].roomId,
      body: `FIXTURE history ${i}`,
      basedOnRoomSeq: await head(channels[0].roomId),
      idempotencyKey: `history-${i}`,
      recipients: [],
    });
  const inventory = await client.request("host.runtime.list", {});
  const offer = inventory.runtimes.find(
    (item) =>
      item.available &&
      item.modelBindingDescriptors.some(
        (binding) => binding.modelId === "gpt-members-fixture",
      ),
  );
  assert.ok(
    offer?.modelBindingDescriptors[0],
    "fixture discovery publishes a model",
  );
  const { role } = await client.request("role.create", {
    controlRoomId: workspace.controlRoomId,
    basedOnRoomSeq: await head(workspace.controlRoomId),
    idempotencyKey: "fixture-member-role",
    configuration: {
      displayName: "FixtureTom",
      handle: "FixtureTom",
      instructions: "FIXTURE ONLY",
      role: "FIXTURE ONLY",
      runtimeOfferId: offer.runtimeOfferId,
      modelIntent: {
        fallback: "disabled",
        exactBindingIds: [offer.modelBindingDescriptors[0].modelBindingId],
      },
    },
  });
  const instanceNames = [];
  const instances = [];
  for (let i = 0; i < 2; i++) {
    const result = await client.request("role.instantiate", {
      roleId: role.roleId,
      channelId: channels[2].roomId,
      basedOnRoomSeq: await head(channels[2].roomId),
      idempotencyKey: `fixture-member-${i}`,
    });
    instanceNames.push(result.agent.handle);
    instances.push(result.instance);
  }
  browser = await chromium.launch({ headless: true });
  if (process.env.LOOM_BROWSER_SLICE === "saved") {
    console.log(
      JSON.stringify(
        await verifySaved({
          browser,
          origin,
          channels,
          client,
          workspace,
          head,
        }),
      ),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "reactions") {
    console.log(
      JSON.stringify(
        await verifyReactions({ browser, origin, channels, client, head }),
      ),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "fonts") {
    console.log(JSON.stringify(await verifyLocalFonts({ browser, origin })));
  } else if (process.env.LOOM_BROWSER_SLICE === "notifications") {
    console.log(
      JSON.stringify(await verifyNotifications({ browser, origin, channels })),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "thread-followers") {
    console.log(
      JSON.stringify(
        await verifyThreadFollowers({
          browser,
          origin,
          client,
          channel: channels[2],
          instances,
          head,
        }),
      ),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "threads") {
    console.log(
      JSON.stringify(
        await verifyThreads({
          browser,
          origin,
          client,
          workspace,
          otherChannel: channels[1],
          head,
        }),
      ),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "layout") {
    console.log(
      JSON.stringify(await verifyLayout({ browser, origin, channels, client })),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "topbar") {
    console.log(
      JSON.stringify(await verifyTopbar({ browser, origin, channels })),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "appearance") {
    console.log(
      JSON.stringify(
        await verifyAppearance({
          browser,
          origin,
          client,
          workspace,
          channels,
          instances,
        }),
      ),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "attachments") {
    console.log(
      JSON.stringify(
        await verifyAttachments({ browser, origin, client, workspace, head }),
      ),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "attachment-preview") {
    console.log(
      JSON.stringify(
        await verifyAttachmentPreview({
          browser,
          origin,
          client,
          workspace,
          head,
        }),
      ),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "about") {
    console.log(JSON.stringify(await verifyAbout({ browser, origin })));
  } else if (process.env.LOOM_BROWSER_SLICE === "task-board") {
    console.log(
      JSON.stringify(
        await verifyTaskBoard({ browser, origin, client, workspace, head }),
      ),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "account-settings") {
    console.log(
      JSON.stringify(await verifyAccountSettings({ browser, origin, client })),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "system-settings") {
    console.log(
      JSON.stringify(
        await verifySystemSettings({ browser, origin, client, workspace }),
      ),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "settings-archive") {
    console.log(
      JSON.stringify(
        await verifySettingsArchive({
          browser,
          origin,
          client,
          workspace,
          head,
        }),
      ),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "task-create") {
    console.log(
      JSON.stringify(
        await verifyTaskCreate({ browser, origin, client, workspace, head }),
      ),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "search-history") {
    console.log(
      JSON.stringify(await verifySearchHistory({ browser, origin, channels })),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "activity-return") {
    console.log(
      JSON.stringify(
        await verifyActivityReturn({ browser, origin, client, workspace }),
      ),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "search-recent") {
    console.log(
      JSON.stringify(await verifySearchRecent({ browser, origin, channels })),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "search-entities") {
    console.log(
      JSON.stringify(
        await verifySearchEntities({
          browser,
          origin,
          client,
          workspace,
          channels,
          instances,
          head,
        }),
      ),
    );
  } else if (process.env.LOOM_BROWSER_SLICE === "activity-navigation") {
    console.log(
      JSON.stringify(
        await verifyActivityNavigation({
          browser,
          origin,
          client,
          workspace,
          head,
          instances,
          role,
        }),
      ),
    );
  } else {
    const settingsNavigationResults = await verifySettingsNavigation({
      browser,
      origin,
    });
    const controlResults = await verifyChannelControls({
      browser,
      origin,
      client,
      channel: channels[0],
    });
    const systemNoticeResults = await verifySystemNotices({
      browser,
      origin,
      client,
      workspace,
      head,
    });
    for (const instance of instances)
      await client.request("agent.manage", {
        action: "set_state",
        agentId: instance.agentId,
        state: "disabled",
        basedOnRoomSeq: await head(workspace.controlRoomId),
        idempotencyKey: `fixture-mention-disable-${instance.instanceId}`,
      });
    const mentionResults = await verifyMentions({
      browser,
      origin,
      client,
      channel: channels[2],
      otherChannel: channels[0],
      instance: instances[0],
      name: instanceNames[0],
    });
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      const errors = [];
      const external = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (route) => {
        if (new URL(route.request().url()).origin !== origin) {
          external.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      await verifyChatBootstrap(page, origin, channels[0].roomId);
      await verifyMobileChatNavigation(page, channels[0].roomId);
      await openChatRow(page, channels[2].roomId);
      const memberButton = page.getByRole("button", { name: "频道成员与状态" });
      await memberButton.click();
      const memberDialog = page.getByRole("dialog");
      await memberDialog.getByText(instanceNames[0], { exact: true }).waitFor();
      await memberDialog.getByText(instanceNames[1], { exact: true }).waitFor();
      assert.equal(
        await memberDialog
          .getByText("空闲 · 本频道无排队工作", { exact: true })
          .count(),
        2,
      );
      await page.screenshot({
        path: join(tmpdir(), `loom-official-members-${viewport.width}.png`),
        animations: "disabled",
      });
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press("Tab");
        await page.waitForFunction(() =>
          document
            .querySelector('[role="dialog"]')
            ?.contains(document.activeElement),
        );
        assert.equal(
          await memberDialog.evaluate((node) =>
            node.contains(document.activeElement),
          ),
          true,
        );
      }
      await page.route("**/v3/client/rooms/agents/activity/list", (route) =>
        route.abort(),
      );
      await memberDialog.getByRole("alert").waitFor();
      assert.equal(
        await memberDialog
          .getByText("空闲 · 本频道无排队工作", { exact: true })
          .count(),
        0,
        "failed read must not retain a stale idle label",
      );
      await page.unroute("**/v3/client/rooms/agents/activity/list");
      await memberDialog.getByText(instanceNames[0], { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await memberDialog.waitFor({ state: "hidden" });
      assert.equal(
        await memberButton.evaluate((node) => node === document.activeElement),
        true,
      );
      await memberButton.press("Enter");
      await memberDialog.waitFor();
      await page.getByRole("button", { name: "关闭成员列表" }).click();
      await memberDialog.waitFor({ state: "hidden" });
      await memberButton.click();
      await memberDialog.waitFor();
      await page.mouse.click(4, 4);
      await memberDialog.waitFor({ state: "hidden" });
      await openChatRow(page, channels[0].roomId);
      await memberButton.click();
      await memberDialog.getByText("Human", { exact: true }).waitFor();
      assert.equal(
        await memberDialog.getByText(instanceNames[0], { exact: true }).count(),
        0,
      );
      await page.keyboard.press("Escape");
      const composer = page.getByTestId("composer-textarea");
      await composer.waitFor({ timeout: 20000 });
      const columns = await page.evaluate(() => {
        const sidebar = document
          .querySelector('[data-testid="public-server-channel-sidebar-root"]')
          .getBoundingClientRect();
        const timeline = document
          .querySelector('[data-testid="composer-textarea"]')
          .getBoundingClientRect();
        return {
          sidebarRight: sidebar.right,
          sidebarWidth: sidebar.width,
          composerLeft: timeline.left,
        };
      });
      if (viewport.width >= 768) {
        assert.ok(
          columns.composerLeft >= columns.sidebarRight,
          "desktop shell columns stay side by side",
        );
      } else {
        assert.equal(
          columns.sidebarWidth,
          0,
          "mobile detail hides the list column",
        );
      }
      await page.getByText("FIXTURE history 55", { exact: true }).waitFor();
      const timeline = page.getByTestId("loom-message-timeline");
      await timeline.evaluate((node) => {
        node.scrollTop = 0;
      });
      await page.getByText("FIXTURE history 1", { exact: true }).waitFor();
      await timeline.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      const body = `FIXTURE send ${viewport.width}`;
      await composer.fill(body);
      await composer.press("Enter");
      await page.getByText(body, { exact: true }).waitFor();
      assert.equal(
        (
          await client.request("message.list", {
            roomId: channels[0].roomId,
            limit: 100,
          })
        ).messages.filter((m) => m.body === body).length,
        1,
      );
      await page.reload();
      await page.getByText(body, { exact: true }).waitFor();
      await openChatRow(page, channels[1].roomId);
      await page
        .locator('textarea[placeholder="发送到 #FIXTURE Beta"]')
        .waitFor();
      if (viewport.width === 1440)
        await page.getByText("频道还没有消息", { exact: true }).waitFor();
      else await page.getByText("FIXTURE lost 1440", { exact: true }).waitFor();
      assert.equal(await page.getByText(body, { exact: true }).count(), 0);
      await composer.fill("FIXTURE IME");
      await composer.dispatchEvent("keydown", {
        key: "Enter",
        code: "Enter",
        isComposing: true,
        keyCode: 229,
      });
      assert.equal(await composer.inputValue(), "FIXTURE IME");
      await composer.press("Shift+Enter");
      assert.ok((await composer.inputValue()).includes("\n"));
      let dropped = false;
      const sendRequests = [];
      await page.route("**/v3/client/messages/post", async (route) => {
        sendRequests.push(route.request().postDataJSON());
        if (!dropped) {
          dropped = true;
          await route.fetch();
          await route.abort();
        } else await route.continue();
      });
      await composer.fill(`FIXTURE lost ${viewport.width}`);
      await composer.press("Enter");
      await page.getByRole("button", { name: "核实发送" }).waitFor();
      assert.equal(sendRequests.length, 1);
      const unreadTarget = page.locator(
        `[data-public-channel-id="${channels[2].roomId}"]`,
      );
      await showChatList(page);
      await unreadTarget.click({ button: "right" });
      await page
        .getByRole("menuitem", { name: "标记未读", exact: true })
        .click();
      await unreadTarget.locator('[aria-label="有未读消息"]').waitFor();
      const blockedReadMarks = [];
      const observeMark = (request) => {
        if (request.url().endsWith("/activity/mark"))
          blockedReadMarks.push(request.postDataJSON());
      };
      page.on("request", observeMark);
      const blockedUrl = page.url();
      await unreadTarget.click();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      assert.equal(
        page.url(),
        blockedUrl,
        "unknown send blocks leaving the current channel",
      );
      assert.deepEqual(
        blockedReadMarks,
        [],
        "a refused navigation must not acknowledge the unseen channel",
      );
      page.off("request", observeMark);
      const mainNav = page.getByRole("navigation", { name: "主导航" });
      await openFullSearch(page);
      await mainNav.getByRole("button", { name: "频道", exact: true }).click();
      if (viewport.width < 768) await openChatRow(page, channels[1].roomId);
      await page.getByRole("button", { name: "核实发送" }).waitFor();
      assert.equal(
        sendRequests.length,
        1,
        "global navigation must not resend an unknown write",
      );
      await page.evaluate((room) => {
        history.pushState({}, "", `?room=${room}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, channels[0].roomId);
      await page.getByText(body, { exact: true }).waitFor();
      await page.evaluate((room) => {
        history.back();
      }, channels[1].roomId);
      await page.getByRole("button", { name: "核实发送" }).waitFor();
      await page.getByRole("button", { name: "核实发送" }).click();
      await page
        .getByText(`FIXTURE lost ${viewport.width}`, { exact: true })
        .waitFor();
      assert.deepEqual(sendRequests[0], sendRequests[1]);
      assert.equal(
        await composer.inputValue(),
        "",
        "confirmed delivery must not leave the sent draft ready to send again",
      );
      assert.equal(
        (
          await client.request("message.list", {
            roomId: channels[1].roomId,
            limit: 100,
          })
        ).messages.filter((m) => m.body === `FIXTURE lost ${viewport.width}`)
          .length,
        1,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      await assertSparseHistoryStartsAtTop(
        page,
        viewport.width === 1440
          ? ["FIXTURE lost 1440"]
          : ["FIXTURE lost 1440", "FIXTURE lost 390"],
      );
      await page.screenshot({
        path: join(tmpdir(), `loom-official-channel-${viewport.width}.png`),
      });
      await page.goto(`${origin}/?room=unavailable-channel`);
      await page
        .getByText("此频道不存在或没有访问权限", { exact: true })
        .waitFor();
      assert.equal(await page.getByTestId("composer-textarea").count(), 0);
      results.push({
        viewport,
        memberNamesAndIdleState: true,
        memberChannelIsolation: true,
        memberReadFailureClearsStaleStatusAndRecovers: true,
        memberDialogPointerKeyboardFocus: true,
        sendAndReload: true,
        historyPagination: true,
        sparseHistoryTopAlignedAndChronological: true,
        unavailableChannelFailsClosed: true,
        mobileMasterDetailDraftAndHistory: viewport.width < 768,
        switchIsolation: true,
        ime: true,
        unknownResultVerified: true,
        unknownSendPreservedAcrossGlobalNavigation: true,
        externalRequests: 0,
      });
      await context.close();
    }
    const privateResults = await verifyPrivateBoxes({
      browser,
      origin,
      client,
      workspace,
      channel: channels[2],
      instance: instances[0],
      name: instanceNames[0],
      head,
    });
    const navigationResults = await verifyGlobalNavigation({
      browser,
      origin,
      channel: channels[0],
    });
    const instanceResults = await verifyInstanceCreation({
      browser,
      origin,
      client,
      workspace,
      channel: channels[2],
      role,
    });
    const sidebarActionResults = await verifySidebarActions({
      browser,
      origin,
      client,
      workspace,
      channel: channels[0],
    });
    const managementResults = await verifyManagement({
      browser,
      origin,
      client,
      workspace,
      channel: channels[2],
      offer,
    });
    const discoveryResults = await verifyDiscovery({
      browser,
      origin,
      client,
      workspace,
      channel: channels[0],
    });
    const threadResults = await verifyThreads({
      browser,
      origin,
      client,
      workspace,
      otherChannel: channels[1],
      head,
    });
    const taskResults = await verifyTasks({
      browser,
      origin,
      client,
      workspace,
      head,
    });
    const channelTaskResults = await verifyChannelTasks({
      browser,
      origin,
      client,
      workspace,
      head,
    });
    const attachmentDetails = await verifyAttachmentDetails({
      browser,
      origin,
      client,
      workspace,
      head,
      role,
    });
    const attachmentResults = await verifyAttachments({
      browser,
      origin,
      client,
      workspace,
      head,
    });
    const taskManagementResults = await verifyTaskManagement({
      browser,
      origin,
      client,
      workspace,
      head,
      role,
    });
    console.log(
      JSON.stringify(
        {
          attachmentDetails,
          attachmentResults,
          taskManagementResults,
          channelTaskResults,
          taskResults,
          threadResults,
          settingsNavigationResults,
          controlResults,
          mentionResults,
          systemNoticeResults,
          fixtureOnly: true,
          realCore: true,
          paidCli: false,
          results,
          privateResults,
          instanceResults,
          navigationResults,
          managementResults,
          sidebarActionResults,
          discoveryResults,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await browser?.close();
  await running?.stop();
  rmSync(directory, { recursive: true, force: true });
}
