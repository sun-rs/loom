import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
export async function verifyUIRefresh135({ browser, origin, channels }) {
  const results = [],
    output = process.env.LOOM_UI_SCREENSHOT_DIR ?? "/tmp/loom-ui-refresh135";
  await mkdir(output, { recursive: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      hasTouch: width === 390,
      isMobile: width === 390,
      locale: "zh-CN",
    });
    const page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(5000);
    page.on("pageerror", (e) => errors.push(e.message));
    let emptyRoles = false,
      emptyRooms = false;
    let inventoryGate = Promise.resolve(),
      releaseInventory = () => {};
    await page.route("**/v1/local/runtimes/list", async (route) => {
      await inventoryGate;
      await route.continue();
    });
    const press = async (locator) =>
      width === 390 ? locator.tap() : locator.click();
    await page.route("**/v3/client/roles/list", async (route) => {
      const response = await route.fetch(),
        body = await response.json();
      if (emptyRoles) {
        body.deletedRoles = body.roles.length
          ? [
              {
                ...body.roles[0],
                roleId: "fixture-retired",
                configuration: {
                  ...body.roles[0].configuration,
                  displayName: "RetiredFixture",
                  handle: "RetiredFixture",
                },
              },
            ]
          : [];
        body.roles = [];
        body.instances = [];
      }
      await route.fulfill({ response, json: body });
    });
    await page.route("**/v3/client/rooms/list", async (route) => {
      const response = await route.fetch(),
        body = await response.json();
      if (emptyRooms)
        body.rooms = body.rooms.filter((r) => r.kind !== "channel");
      await route.fulfill({ response, json: body });
    });
    const screenshot = async (name) => {
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        name + " horizontal overflow",
      );
      await page.screenshot({ path: join(output, `${name}-${width}.png`) });
    };
    try {
      await page.goto(origin + "/?view=settings&settings=appearance");
      await page.getByTestId("settings-server-theme-link").waitFor();
      assert.equal(
        await page.getByTestId("appearance-theme-picker").count(),
        0,
        "mode moved out of Appearance",
      );
      await screenshot("appearance");
      await page.getByTestId("settings-server-theme-link").click();
      await page.getByTestId("server-theme-mode").waitFor();
      await page
        .getByTestId("appearance-theme-dark")
        .locator('[data-slot="card"]')
        .click();
      await page.waitForFunction(() =>
        document.documentElement.classList.contains("dark"),
      );
      await page.reload();
      await page.getByTestId("server-theme-mode").waitFor();
      assert.ok(
        await page.evaluate(() =>
          document.documentElement.classList.contains("dark"),
        ),
        "device mode persists",
      );
      await page
        .getByTestId("appearance-theme-light")
        .locator('[data-slot="card"]')
        .click();
      await screenshot("theme");
      await page.goto(origin + "/?view=settings&settings=notifications");
      await page.getByTestId("settings-server-notifications-link").waitFor();
      assert.equal(await page.getByTestId("server-mute-card").count(), 0);
      await page.getByTestId("settings-server-notifications-link").click();
      const mute = page.getByTestId("server-mute-card");
      await mute.waitFor();
      const check = mute.getByRole("checkbox");
      await check.waitFor();
      await page.waitForFunction(
        () =>
          !document
            .querySelector('[data-testid="server-mute-card"] [role="checkbox"]')
            .hasAttribute("disabled"),
      );
      const original = await check.isChecked();
      await check.click();
      await mute.getByRole("button", { name: "保存", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector(
            '[data-testid="server-mute-card"] button[type="submit"]',
          )?.disabled,
      );
      await page.reload();
      await mute.waitFor();
      assert.equal(await check.isChecked(), !original, "workspace mute saved");
      await screenshot("workspace-notifications");
      await check.click();
      await mute.getByRole("button", { name: "保存", exact: true }).click();
      await page.goto(origin + "/?view=activity");
      const filter = page.getByTestId("inbox-filter-button");
      await filter.waitFor();
      assert.equal(await page.getByTestId("inbox-filter-chip").count(), 0);
      await press(filter);
      await press(page.getByTestId("inbox-filter-unread"));
      await page.getByTestId("inbox-filter-chip").waitFor();
      assert.equal(
        await page.getByTestId("inbox-filter-chip").getAttribute("data-filter"),
        "unread",
      );
      await screenshot("activity-filter");
      await page.keyboard.press("Escape");
      await page.getByTestId("inbox-filter-menu").waitFor({ state: "hidden" });
      await press(page.getByTestId("inbox-filter-clear"));
      await page.getByTestId("inbox-filter-chip").waitFor({ state: "hidden" });
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute("data-testid") ===
          "inbox-filter-button",
      );
      await press(filter);
      await page.keyboard.press("Escape");
      inventoryGate = new Promise((resolve) => {
        releaseInventory = resolve;
      });
      await page.goto(origin + "/?view=agents");
      await page
        .getByTestId("loom-role-list")
        .getByText("FixtureTom", { exact: true })
        .waitFor();
      releaseInventory();
      await page
        .locator(
          '[data-testid^="sidebar-agent-machine-group-toggle-"]:not([data-testid$="__unconfirmed__"])',
        )
        .waitFor();
      const group = page
        .locator('[data-testid^="sidebar-agent-machine-group-toggle-"]')
        .first();
      await group.waitFor();
      const groupName = await group.innerText();
      assert.ok(
        !groupName.includes("未确认"),
        "published runtime binding maps Role to local Computer",
      );
      await press(group);
      assert.equal(await group.getAttribute("aria-expanded"), "false");
      await page.reload();
      await group.waitFor();
      assert.equal(await group.getAttribute("aria-expanded"), "false");
      await press(group);
      await screenshot("role-computer-group");
      // Read-only response fixtures: zero instances/roles/rooms, no provider calls or formal data mutation.
      emptyRoles = true;
      await page.goto(origin + "/?view=computers");
      if (width === 390) await page.getByTestId("computer-mobile-row").click();
      const zero = page.getByTestId("computer-instances-empty");
      await zero.waitFor();
      assert.equal(
        await page
          .getByTestId("computer-instances")
          .locator('[data-slot="list-row-group"]')
          .count(),
        0,
        "no border-only list at zero",
      );
      await screenshot("computer-zero");
      await page.goto(origin + "/?room=" + channels[1].roomId);
      await page.getByTestId("empty-messages").waitFor();
      assert.equal(
        await page.getByTestId("empty-messages").locator("svg").count(),
        1,
      );
      await screenshot("empty-conversation");
      emptyRooms = true;
      await page.goto(origin + "/?view=agents");
      await page.locator('[data-testid="empty-roles"]:visible').waitFor();
      await screenshot("empty-roles");
      await page.goto(origin + "/?view=memory");
      await page.getByTestId("empty-memory").waitFor();
      await screenshot("empty-memory");
      await page.goto(origin + "/?view=tasks");
      await page.getByTestId("tasks-empty").waitFor();
      assert.ok(
        (await page.getByTestId("tasks-empty").innerText()).includes(
          "还没有任务",
        ),
      );
      await screenshot("empty-tasks");
      await page.goto(origin + "/?chat=list");
      await page
        .getByTestId(
          width === 1440 ? "empty-conversation" : "empty-channel-list",
        )
        .waitFor();
      await screenshot("empty-chats");
      assert.deepEqual(errors, []);
      results.push({
        width,
        appearance: true,
        themeModePersistence: true,
        workspaceMutePersistence: true,
        filterMenuClearAndFocus: true,
        computerGroupsPersist: true,
        zeroInstanceNoBorder: true,
        emptyMessagesRolesMemoryTasksChats: true,
        errors,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          failedWidth: width,
          url: page.url(),
          errors,
          body: (await page.locator("body").innerText()).slice(0, 3500),
        }),
      );
      await page.screenshot({
        path: join(output, "failure-" + width + ".png"),
      });
      throw error;
    } finally {
      releaseInventory();
      await context.close();
    }
  }
  return {
    kind: "isolated UI fixture; no paid providers or formal workspace writes",
    screenshots: output,
    results,
  };
}
