// Isolated Core and native UI only. No paid model or production mutations.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
export async function verifyRoleIdentity({
  browser,
  origin,
  client,
  workspace,
  head,
  role,
}) {
  const results = [];
  const inventory = await client.request("host.runtime.list", {});
  for (const width of [1440, 390]) {
    const { avatarKey, ...base } = role.configuration;
    const created = (
      await client.request("role.create", {
        controlRoomId: workspace.controlRoomId,
        basedOnRoomSeq: await head(workspace.controlRoomId),
        idempotencyKey: `identity-role-${width}`,
        configuration: {
          ...base,
          displayName: `IdentityFixture${width}`,
          role: `IdentityFixture${width}`,
          description: "FIXTURE display note",
          instructions: "FIXTURE only execution prompt",
        },
      })
    ).role;
    assert.match(created.configuration.avatarKey, /^pixel:/);
    const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 1000 },
        locale: "zh-CN",
        hasTouch: width === 390,
        isMobile: width === 390,
      }),
      page = await context.newPage(),
      errors = [],
      writes = [];
    page.setDefaultTimeout(7000);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().endsWith("/v3/client/roles/revise"))
        writes.push(r.postDataJSON());
    });
    try {
      const current = async () =>
        (
          await client.request("role.list", {
            controlRoomId: workspace.controlRoomId,
          })
        ).roles.find((r) => r.roleId === created.roleId);
      await page.goto(`${origin}/?view=agents&role=${created.roleId}`);
      const profile = page.getByTestId("loom-role-profile"),
        row = page.locator(`[data-role-id="${created.roleId}"]`);
      await profile.waitFor();
      assert.equal(
        await profile.getByTestId("role-description").textContent(),
        "FIXTURE display note",
      );
      assert.equal(
        await profile.getByTestId("role-instructions").textContent(),
        "FIXTURE only execution prompt",
      );
      assert.ok((await row.textContent()).includes("FIXTURE display note"));
      const runtime = inventory.runtimes.find(
        (r) => r.runtimeOfferId === base.runtimeOfferId,
      );
      await row
        .getByTestId("sidebar-agent-runtime")
        .waitFor({ state: "attached" });
      assert.equal(
        await row.getByTestId("sidebar-agent-runtime").textContent(),
        "Codex",
      );
      assert.equal(
        await profile
          .getByRole("button", { name: "编辑描述", exact: true })
          .count(),
        1,
      );
      await profile
        .getByRole("button", { name: "编辑描述", exact: true })
        .click();
      const dialog = page.getByTestId("role-description-dialog");
      await dialog.waitFor();
      await dialog
        .getByLabel("描述", { exact: true })
        .fill("FIXTURE revised note");
      await dialog
        .getByLabel("提示词", { exact: true })
        .fill("FIXTURE revised prompt");
      assert.equal(
        (await current()).configuration.description,
        "FIXTURE display note",
        "draft does not mutate the Role",
      );
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(
        (await current()).configuration.instructions,
        "FIXTURE revised prompt",
      );
      assert.equal(
        (await current()).configuration.description,
        "FIXTURE revised note",
      );
      assert.equal(writes.length, 1, "two fields commit as one revision");
      assert.equal(
        (await current()).configuration.avatarKey,
        created.configuration.avatarKey,
      );
      await profile
        .getByRole("button", { name: "编辑描述", exact: true })
        .click();
      await dialog.getByLabel("描述", { exact: true }).fill("");
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal((await current()).configuration.description, "");
      const fallback = await profile
        .getByTestId("role-description")
        .textContent();
      assert.ok(fallback.includes(" · "));
      assert.ok((await row.textContent()).includes(fallback));
      await profile
        .getByRole("button", { name: "编辑描述", exact: true })
        .click();
      assert.equal(
        await dialog.getByLabel("描述", { exact: true }).inputValue(),
        "",
      );
      assert.equal(
        await dialog
          .getByLabel("描述", { exact: true })
          .getAttribute("placeholder"),
        fallback,
      );
      await dialog
        .getByLabel("描述", { exact: true })
        .fill("FIXTURE must discard");
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      await page.getByRole("button", { name: "放弃修改", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(writes.length, 2);
      const imageRequests = new Set();
      page.on("request", (r) => {
        if (r.url().includes("/avatars/pokemon/")) imageRequests.add(r.url());
      });
      for (const [name, key] of [
        ["皮卡丘", "pokemon-025"],
        ["未知图腾-？", "pokemon-201-question"],
        ["代欧奇希斯-防御形态", "pokemon-386-defense"],
        ["小约克", "pokemon-506"],
      ]) {
        await profile
          .getByRole("button", { name: "更换头像", exact: true })
          .click();
        const picker = page.getByTestId("role-avatar-dialog");
        await picker.waitFor();
        const choices = picker.locator('button[aria-label^="头像 "]');
        assert.equal(
          await choices.count(),
          60,
          "opening the picker does not mount/download all 539 portraits",
        );
        if (name === "皮卡丘") {
          await picker.getByTestId("avatar-library-more").click();
          assert.equal(await choices.count(), 120);
          assert.ok(imageRequests.size < 539);
        }
        await picker.getByLabel("搜索头像", { exact: true }).fill(name);
        const choice = picker.getByRole("button", {
          name: `头像 ${name}`,
          exact: true,
        });
        await choice.click();
        assert.equal(await choice.getAttribute("aria-pressed"), "true");
        assert.equal(
          await choice.locator("img[data-agent-pixel-avatar]").count(),
          1,
          "one image per sprite, native rendering stays bounded",
        );
        const img = choice.locator("img");
        await img.waitFor();
        await page.waitForFunction(
          (src) =>
            [...document.images].some(
              (i) => i.src === src && i.complete && i.naturalWidth === 512,
            ),
          await img.getAttribute("src").then((s) => new URL(s, origin).href),
        );
        assert.match(await img.getAttribute("src"), /\/avatars\/pokemon\//);
        if (name === "皮卡丘")
          await page.screenshot({
            path: `/tmp/loom-pokemon-avatar-${width}.png`,
            animations: "disabled",
          });
        await picker.getByRole("button", { name: "保存", exact: true }).click();
        await picker.waitFor({ state: "hidden" });
        assert.equal((await current()).configuration.avatarKey, `pixel:${key}`);
      }
      await page.reload();
      await profile.waitFor();
      assert.equal(
        (await current()).configuration.avatarKey,
        "pixel:pokemon-506",
      );
      assert.equal(
        (await current()).configuration.instructions,
        "FIXTURE revised prompt",
      );
      await page.screenshot({
        path: `/tmp/loom-role-identity-${width}.png`,
        animations: "disabled",
      });
      assert.deepEqual(errors, []);
      results.push({
        width,
        randomDefault: true,
        descriptionPromptIndependent: true,
        oneRevision: true,
        grayPlaceholderNotStored: true,
        discardGuard: true,
        pokemonSelectionAndDistinctForms: true,
        incrementalImages: imageRequests.size < 539,
        requestedImages: imageRequests.size,
        reload: true,
        nativeRuntimeColumn: true,
        errors,
      });
    } catch (error) {
      await page.screenshot({
        path: "/tmp/loom-role-identity-failure.png",
        fullPage: true,
      });
      writeFileSync(
        "/tmp/loom-role-identity-failure.html",
        await page.content(),
      );
      throw error;
    } finally {
      await context.close();
    }
  }
  return results;
}
