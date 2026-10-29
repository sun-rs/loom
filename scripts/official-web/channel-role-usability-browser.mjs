// Temporary Core and fake discovery; no paid execution or production writes.
import assert from "node:assert/strict";
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { showChatList } from "./mobile-chat-browser.mjs";
import { chooseOption } from "./select-browser.mjs";
export async function verifyChannelRoleUsability({
  browser,
  origin,
  client,
  workspace,
  head,
  role,
}) {
  const root = realpathSync(
      mkdtempSync(join(tmpdir(), "loom-folder-fixture-")),
    ),
    results = [];
  mkdirSync(join(root, "Project"));
  writeFileSync(join(root, "not-a-folder.txt"), "fixture");
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
          viewport: { width, height: width === 390 ? 844 : 1000 },
          locale: "zh-CN",
          hasTouch: width === 390,
          isMobile: width === 390,
        }),
        page = await context.newPage();
      page.setDefaultTimeout(8000);
      const errors = [],
        creates = [],
        adds = [];
      page.on("pageerror", (e) => errors.push(e.message));
      // Real file listing, confined to our fixture root. Real Kernel validates selected directories.
      await page.route("**/v3/client/computers/files/list", (route) => {
        const body = route.request().postDataJSON();
        return route.continue({
          postData: JSON.stringify({
            ...body,
            ...(!body.path ? { path: root.replace(/^\//, "") } : {}),
          }),
        });
      });
      let lose = true;
      await page.route("**/v3/client/roles/instantiate", async (route) => {
        adds.push(route.request().postDataJSON());
        if (lose) {
          lose = false;
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          return route.abort();
        }
        return route.continue();
      });
      page.on("request", (r) => {
        if (r.url().endsWith("/rooms/create")) creates.push(r.postDataJSON());
      });
      await page.goto(origin);
      await showChatList(page);
      await page
        .getByTestId("sidebar-surface")
        .click({ button: "right", position: { x: 3, y: 3 } });
      await page
        .getByRole("menuitem", { name: "新建频道", exact: true })
        .click();
      const dialog = page.getByTestId("loom-create-channel");
      await dialog.waitFor();
      await dialog
        .getByRole("textbox", { name: /^名称/ })
        .fill("FIXTURE folders " + width);
      await dialog
        .getByRole("textbox", { name: /^描述/ })
        .fill("FIXTURE optional description");
      assert.equal(await dialog.getByText(/公开|私密/).count(), 0);
      await dialog.getByRole("button", { name: "添加工作区文件夹" }).click();
      const chooser = page.getByTestId("computer-file-dialog");
      await chooser
        .getByRole("button", { name: "Project", exact: true })
        .waitFor();
      assert.equal(
        await chooser
          .getByRole("button", { name: "not-a-folder.txt", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await chooser.getByTestId("loom-native-file-input").count(),
        0,
      );
      await chooser
        .getByRole("button", { name: "Project", exact: true })
        .click();
      await page.waitForResponse((r) =>
        r.url().endsWith("/computers/files/list"),
      );
      await chooser
        .getByRole("button", { name: "选择此文件夹", exact: true })
        .click();
      await chooser.waitFor({ state: "hidden" });
      await dialog
        .getByRole("button", {
          name: role.configuration.displayName,
          exact: true,
        })
        .click();
      await page.screenshot({ path: `/tmp/loom-create-channel-${width}.png` });
      await dialog
        .getByRole("button", { name: "创建频道", exact: true })
        .click();
      await dialog.getByRole("button", { name: "核实操作结果" }).click();
      await dialog.waitFor({ state: "hidden" });
      const room = (
        await client.request("room.list", {
          workspaceId: workspace.workspaceId,
        })
      ).rooms.find((r) => r.name === "FIXTURE folders " + width);
      assert.ok(room);
      assert.equal(room.description, "FIXTURE optional description");
      assert.deepEqual(
        room.channelWorkspace.additionalDirectories.map((d) =>
          typeof d === "string" ? d : (d.path ?? d.absolutePath),
        ),
        [join(root, "Project")],
      );
      const members = (
        await client.request("role.list", {
          controlRoomId: workspace.controlRoomId,
        })
      ).instances.filter((i) => i.channelId === room.roomId);
      assert.equal(members.length, 1);
      assert.equal(adds.length, 2);
      assert.equal(adds[0].idempotencyKey, adds[1].idempotencyKey);
      await page.route("**/v1/local/runtimes/list", async (route) => {
        const response = await route.fetch(),
          body = await response.json();
        for (const runtime of body.runtimes)
          if (runtime.modelBindingDescriptors[0])
            runtime.modelBindingDescriptors[0].displayName =
              "local:opencode-cli/v1:deepseek/deepseek-flash";
        await route.fulfill({ response, json: body });
      });
      // Native Role creation with blank prompt and fixed published effort.
      await page.goto(origin + "/?view=agents");
      assert.equal(
        await page.getByRole("textbox", { name: "筛选角色" }).count(),
        0,
      );
      await page.getByRole("button", { name: "新建角色", exact: true }).click();
      const rd = page.getByTestId("loom-create-role");
      await rd
        .getByRole("textbox", { name: /^名称/ })
        .fill("BlankPromptFixture" + width);
      await chooseOption(page, rd, "运行时", 0);
      await chooseOption(page, rd, "模型", 0);
      assert.doesNotMatch(
        await rd.getByRole("combobox", { name: /^模型/ }).textContent(),
        /local:opencode-cli/,
      );
      assert.equal(
        await rd
          .getByRole("combobox", { name: "推理强度", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await rd.getByLabel("提示词", { exact: true }).inputValue(),
        "",
      );
      await rd.getByRole("button", { name: "保存角色", exact: true }).click();
      await rd.waitFor({ state: "hidden" });
      const empty = (
        await client.request("role.list", {
          controlRoomId: workspace.controlRoomId,
        })
      ).roles.find(
        (r) => r.configuration.displayName === "BlankPromptFixture" + width,
      );
      assert.equal(empty.configuration.instructions, "");
      assert.equal(empty.configuration.modelIntent.reasoning, "low");
      await page.goto(origin + "/?view=agents&role=" + empty.roleId);
      await page.getByRole("button", { name: "编辑描述", exact: true }).click();
      const editor = page.getByTestId("role-description-dialog");
      await editor.getByRole("textbox", { name: /^描述/ }).fill("Note only");
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await editor.waitFor({ state: "hidden" });
      assert.equal(
        (
          await client.request("role.list", {
            controlRoomId: workspace.controlRoomId,
          })
        ).roles.find((r) => r.roleId === empty.roleId).configuration
          .instructions,
        "",
      );
      await page.getByRole("button", { name: "更换头像", exact: true }).click();
      const avatars = page.getByTestId("role-avatar-dialog");
      await avatars.getByLabel("搜索头像").fill("初号机");
      const image = avatars
        .getByRole("button", { name: "头像 初号机", exact: true })
        .locator("img");
      await image.waitFor();
      assert.match(
        decodeURIComponent((await image.getAttribute("src")).split(",")[1]),
        /viewBox="0 0 32 32"/,
      );
      await page.screenshot({ path: `/tmp/loom-detailed-avatar-${width}.png` });
      assert.deepEqual(errors, []);
      results.push({
        width,
        realFolderTree: true,
        channelDescription: true,
        optionalMemberExactlyOnceAfterLostResponse: true,
        blankPromptCreatedAndRevised: true,
        fixedEffortRetainedWithoutPicker: true,
        detailedAvatar32: true,
      });
      await client.request("room.delete", {
        roomId: room.roomId,
        basedOnRoomSeq: await head(room.roomId),
        idempotencyKey: "cleanup-folder-" + width,
      });
      if (room.channelWorkspace?.primaryDirectory)
        rmSync(room.channelWorkspace.primaryDirectory, {
          recursive: true,
          force: true,
        });
      await context.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return results;
}
