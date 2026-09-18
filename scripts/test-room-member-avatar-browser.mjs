import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";

const formalOrigin = process.env.RAH_FORMAL_ORIGIN;
const fixture = formalOrigin ? undefined : await startShellFixture();
const origin = formalOrigin ?? fixture.origin;
const output = mkdtempSync(join(tmpdir(), "rah-room-member-avatar-"));
const browser = await chromium.launch();
const results = [];
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const post = async (path, data) => {
    const response = await page.request.post(`${origin}/v3/client/${path}`, {
      data,
      headers: { Origin: origin },
    });
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const workspace = (await post("workspaces/list", {})).workspaces[0];
  const rooms = await post("rooms/list", {
    workspaceId: workspace.workspaceId,
  });
  const roomId =
    fixture?.roomId ??
    rooms.rooms.find((room) => room.kind === "channel").roomId;
  let variants = [{ kind: "formal" }];
  if (fixture) {
    const upload = await page.request.put(
      `${origin}/v3/client/profile-images/content`,
      {
        headers: { "Content-Type": "image/png", Origin: origin },
        data: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
          "base64",
        ),
      },
    );
    assert.equal(upload.status(), 200, await upload.text());
    const image = await upload.json();
    variants = [
      {
        kind: "uploaded",
        avatarKey: image.avatarKey,
        avatarUploadIntentId: image.uploadIntentId,
      },
      { kind: "preset", avatarKey: "avatar-03" },
      { kind: "initial", avatarKey: null },
    ];
  }
  for (const variant of variants) {
    if (fixture) {
      const { kind: _kind, ...avatar } = variant;
      await post("principals/update", {
        displayName: "Avatar regression human",
        ...avatar,
      });
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto(
        `${origin}/?surface=room&room=${encodeURIComponent(roomId)}`,
      );
      await page
        .getByRole("button", { name: "频道详情与设置", exact: true })
        .click();
      const members = page.locator(".rah-channel-member-avatars");
      const human = members.locator("button").first();
      await expect(human.locator('[role="img"]')).toBeVisible();
      await page
        .locator(".rah-channel-settings-drawer")
        .evaluate(async (drawer) => {
          await Promise.all(
            drawer
              .getAnimations()
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
      const geometry = await human.evaluate((button) => {
        const avatar = button.querySelector('[role="img"]');
        const b = button.getBoundingClientRect(),
          a = avatar.getBoundingClientRect();
        const style = getComputedStyle(button);
        return {
          button: [b.width, b.height],
          avatar: [a.width, a.height],
          offset: [a.x - b.x, a.y - b.y],
          border: style.borderTopWidth,
          padding: style.paddingTop,
          shadow: style.boxShadow,
        };
      });
      assert.deepEqual(
        geometry.avatar,
        [36, 36],
        `${variant.kind}: Human avatar must equal Agent header size`,
      );
      assert.deepEqual(geometry.button, [36, 36]);
      assert.deepEqual(geometry.offset, [0, 0]);
      assert.equal(geometry.border, "0px");
      assert.equal(geometry.shadow, "none");
      if (await human.locator("img").count()) {
        await expect
          .poll(() =>
            human
              .locator("img")
              .evaluate((img) => img.complete && img.naturalWidth > 0),
          )
          .toBe(true);
        const size = await human.locator("img").boundingBox();
        assert.equal(size.width, 32);
        assert.equal(size.height, 32);
      }
      await page.screenshot({
        path: join(output, `${variant.kind}-${width}.png`),
      });
      await human.click();
      await expect(
        page.locator(".rah-room-member-page.is-members"),
      ).toBeVisible();
      results.push({ kind: variant.kind, width, geometry });
    }
  }
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(output);
  await browser.close();
  await fixture?.close();
}
