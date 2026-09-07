import assert from "node:assert/strict";
import { join } from "node:path";

// Production App with the existing isolated Kernel fixture; never OS push proof.
export async function verifyNotificationCenter(page, origin, output, engine) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin, { waitUntil: "load" });
  const trigger = page.locator('.rail button[aria-label^="通知"]');
  const popup = page.getByRole("dialog", { name: "Human Inbox" });
  const composer = page.locator(
    'textarea[aria-label="消息输入框"]:not(:disabled)',
  );
  await composer.waitFor();
  await composer.focus();
  assert.equal(
    await composer.evaluate((e) => e === document.activeElement),
    true,
    "the draft must have focus before the hover experiment starts",
  );
  await trigger.hover();
  await popup.waitFor({ timeout: 2500 });
  assert.equal(
    await composer.evaluate((e) => e === document.activeElement),
    true,
    "hover must not steal the draft's keyboard focus",
  );
  await popup.hover();
  await page.waitForTimeout(200);
  assert.equal(
    await popup.isVisible(),
    true,
    "crossing the gap keeps the popup reachable",
  );
  await page.mouse.move(900, 100);
  await popup.waitFor({ state: "hidden", timeout: 1500 });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await popup.waitFor();
  assert.equal(
    await popup.evaluate((e) => e.contains(document.activeElement)),
    true,
    "keyboard opening focuses the popup",
  );
  await page.keyboard.press("Escape");
  await popup.waitFor({ state: "hidden" });
  assert.equal(
    await trigger.evaluate((e) => e === document.activeElement),
    true,
  );
  await trigger.click();
  await popup.waitFor();
  await composer.click();
  await popup.waitFor({ state: "hidden" });
  assert.equal(
    await composer.evaluate((e) => e === document.activeElement),
    true,
    "outside press preserves the destination focus",
  );
  await trigger.hover();
  await popup.waitFor();
  await page.screenshot({
    path: join(output, `${engine}-notification-center-desktop.png`),
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "load" });
  await page.getByRole("button", { name: "返回主页", exact: true }).click();
  const mobile = page.locator(".rah-mobile-home-notifications");
  await mobile.hover();
  assert.equal(await popup.isVisible(), false, "mobile trigger is click-only");
  await mobile.click();
  await popup.waitFor();
  const bounds = await popup.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.equal(
    await popup.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        ),
      );
    }),
    true,
    "mobile popup must be above the Home sidebar and receive real pointer hits",
  );
  await page.screenshot({
    path: join(output, `${engine}-notification-center-mobile.png`),
  });
  await page.keyboard.press("Escape");
  await popup.waitFor({ state: "hidden" });
  await page.goto(`${origin}/?inputRequest=fixture-notification-link`, {
    waitUntil: "load",
  });
  await popup.waitFor();
  // The active trigger registers during layout after a programmatic open.
  // Wait for published, hittable geometry rather than sampling that transition.
  await page.waitForFunction(() => {
    const element = document.querySelector(".rah-human-inbox");
    if (!element) return false;
    const bounds = element.getBoundingClientRect();
    return (
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.right <= innerWidth &&
      bounds.bottom <= innerHeight &&
      element.contains(
        document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        ),
      )
    );
  });
  const linkedBounds = await popup.boundingBox();
  assert.ok(
    linkedBounds.x >= 0 &&
      linkedBounds.y >= 0 &&
      linkedBounds.x + linkedBounds.width <= 390,
    "programmatic typed-link opening must use a visible trigger",
  );
  await page.keyboard.press("Escape");
  const identity = await (
    await page.request.post(`${origin}/v3/client/principals/me`, { data: {} })
  ).json();
  let mutations = 0;
  const observe = (request) => {
    if (
      /\/(?:notifications\/dismiss|input-requests\/resolve)$/.test(
        new URL(request.url()).pathname,
      )
    )
      mutations++;
  };
  page.on("request", observe);
  // Explicit synthetic pending read: tests nested overlay lifetime, not business acceptance.
  const inputRoute = `${origin}/v3/client/input-requests/list`;
  await page.route(inputRoute, async (route) => {
    const roomId = route.request().postDataJSON().roomId;
    const now = new Date().toISOString();
    await route.fulfill({
      json: {
        inputRequests: [
          {
            inputRequestId: "notification-overlay-fixture",
            roomId,
            taskId: "fixture-task",
            requesterId: "fixture-agent",
            responderId: identity.principal.principalId,
            question: "Synthetic overlay lifetime fixture",
            state: "pending",
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    });
  });
  try {
    await page.goto(`${origin}/?inputRequest=fixture-notification-link`, {
      waitUntil: "load",
    });
    await popup.getByRole("button", { name: "回答", exact: true }).click();
    const answer = page.getByRole("dialog", {
      name: "回答 Agent",
      exact: true,
    });
    await answer.waitFor();
    await answer
      .getByRole("textbox", { name: /你的回答/ })
      .fill("Unsubmitted draft");
    await page.mouse.move(389, 843);
    await page.waitForTimeout(200);
    assert.equal(
      await answer.isVisible(),
      true,
      "leaving the popover must not unmount the answer dialog",
    );
    await page.keyboard.press("Escape");
    await answer.waitFor({ state: "hidden" });
    assert.equal(
      await popup.isVisible(),
      true,
      "first Escape closes only the nested dialog",
    );
    await page.keyboard.press("Escape");
    await popup.waitFor({ state: "hidden" });
    assert.equal(
      mutations,
      0,
      "opening, viewing, cancelling and closing never dismiss or resolve a notification",
    );
  } finally {
    await page.unroute(inputRoute);
    page.off("request", observe);
  }
}
