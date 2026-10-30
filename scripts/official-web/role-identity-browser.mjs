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
      const firstKey =
        created.configuration.avatarKey === "pixel:antenna"
          ? "visor"
          : "antenna";
      if (width === 1440) await page.setViewportSize({ width, height: 720 });
      for (const key of [firstKey, "owl", "rocket", "spider"]) {
        await profile
          .getByRole("button", { name: "更换头像", exact: true })
          .click();
        const picker = page.getByTestId("role-avatar-dialog");
        await picker.waitFor();
        const frame = await picker.evaluate((el) => {
          const r = el.getBoundingClientRect(),
            footer = el.querySelector('[data-slot="dialog-footer"]'),
            f = footer.getBoundingClientRect();
          return {
            width: r.width,
            height: r.height,
            top: r.top,
            footerInBody: !!footer.closest('[data-slot="dialog-body"]'),
            footerBottom: f.bottom,
            footerVisible: getComputedStyle(footer).display !== "none",
            bodyCount: el.querySelectorAll('[data-slot="dialog-body"]').length,
          };
        });
        assert.equal(
          frame.width,
          width === 390 ? 390 : 512,
          "native AgentProfileEditDialog has max-w-lg on desktop and full-width phone sheet",
        );
        assert.equal(frame.bodyCount, 1);
        assert.equal(
          frame.footerInBody,
          false,
          "the native footer is outside the scrolling body",
        );
        if (width === 1440) {
          assert.ok(frame.height <= 688);
          assert.ok(frame.footerVisible);
          assert.ok(frame.footerBottom <= 704);
        } else assert.ok(Math.abs(frame.height - 844 * 0.9) < 1);
        const library = picker.getByTestId("role-avatar-library");
        const choices = library.locator("button[aria-pressed]");
        assert.equal(await choices.count(), 72);
        assert.deepEqual(
          await library
            .locator("[data-avatar-series]")
            .evaluateAll((es) =>
              es.map((e) => e.getAttribute("data-avatar-series")),
            ),
          [
            "bots",
            "critters",
            "space",
            "desk",
            "food",
            "quest",
            "weather",
            "plants",
            "spooky",
          ],
        );
        assert.equal(
          await picker.getByRole("textbox").count(),
          0,
          "native catalog has no custom search",
        );
        assert.equal(
          await picker.getByTestId("avatar-library-more").count(),
          0,
          "native catalog is not paginated",
        );
        const geometry = await choices.first().evaluate((el) => {
          const grid = el.parentElement,
            container = grid.closest(".\\@container");
          return {
            width: el.getBoundingClientRect().width,
            height: el.getBoundingClientRect().height,
            columns:
              getComputedStyle(grid).gridTemplateColumns.split(" ").length,
            containerWidth: container.getBoundingClientRect().width,
          };
        });
        assert.equal(geometry.width, 44);
        assert.equal(geometry.height, 44);
        assert.equal(geometry.columns, geometry.containerWidth >= 408 ? 8 : 4);
        const choice = picker.getByRole("button", { name: key, exact: true });
        await choice.scrollIntoViewIfNeeded();
        await choice.click();
        assert.equal(await choice.getAttribute("aria-pressed"), "true");
        assert.equal(
          await choice.locator("img[data-agent-pixel-avatar]").count(),
          1,
        );
        const src = await choice.locator("img").getAttribute("src");
        assert.match(src, /^data:image\/svg\+xml/);
        assert.match(decodeURIComponent(src), /viewBox="0 0 8 8"/);
        if (key === firstKey)
          await page.screenshot({
            path: `/tmp/loom-official-avatar-${width}.png`,
            animations: "disabled",
          });
        await picker.getByRole("button", { name: "保存", exact: true }).click();
        await picker.waitFor({ state: "hidden" });
        assert.equal((await current()).configuration.avatarKey, `pixel:${key}`);
      }
      assert.equal(
        imageRequests.size,
        0,
        "new official choices do not fetch historical PNGs",
      );
      await page.reload();
      await profile.waitFor();
      assert.equal((await current()).configuration.avatarKey, "pixel:spider");
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
        officialSeriesAndSprites: true,
        noHistoricalImageRequests: imageRequests.size === 0,
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
