import assert from "node:assert/strict";

// Firefox caps one wheel event at roughly one viewport. Do not assume a large
// delta is a seek: send real wheel events until the measured destination exists.
export async function scrollTaskWindow(page, destination) {
  const board = page.locator(".rah-global-kanban");
  await board.hover();
  for (let attempt = 0; attempt < 500; attempt++) {
    const { top, target } = await board.evaluate(
      (element, destination) => ({
        top: element.scrollTop,
        target:
          destination === "end"
            ? element.scrollHeight - element.clientHeight
            : destination === "start"
              ? 0
              : Math.min(
                  destination,
                  element.scrollHeight - element.clientHeight,
                ),
      }),
      destination,
    );
    if (Math.abs(target - top) < 4) return;
    await page.mouse.wheel(0, target - top);
    await page.waitForFunction(
      (previous) =>
        Math.abs(
          document.querySelector(".rah-global-kanban").scrollTop - previous,
        ) > 0.5,
      top,
    );
  }
  assert.fail("Task wheel scrolling did not reach its measured destination");
}
