import assert from "node:assert/strict";
import { expect } from "playwright/test";

export async function verifyComposerAutosize(page, editor, width) {
  const minimum = width >= 768 ? 40 : 20;
  await editor.fill("");
  await expect(editor).toHaveCSS("resize", "none");
  await expect(editor).toHaveCSS("font-size", width >= 768 ? "14px" : "16px");
  await expect
    .poll(() => editor.evaluate((el) => el.getBoundingClientRect().height))
    .toBe(minimum);
  await editor.fill(
    "First line\nSecond line\nThird line\nFourth line\nFifth line",
  );
  await expect
    .poll(() => editor.evaluate((el) => el.getBoundingClientRect().height))
    .toBeGreaterThanOrEqual(100);
  assert.ok(
    await editor.evaluate((el) => el.getBoundingClientRect().height <= 101),
    "five 20px lines plus at most Firefox's 1px native textarea rounding",
  );
  await editor.fill("A line of a long draft\n".repeat(30));
  await expect
    .poll(() => editor.evaluate((el) => el.getBoundingClientRect().height))
    .toBe(128);
  await expect(editor).toHaveCSS("overflow-y", "auto");
  assert.ok(await editor.evaluate((el) => el.scrollHeight > el.clientHeight));
  await editor.evaluate((el) => {
    el.scrollTop = 40;
  });
  assert.ok(await editor.evaluate((el) => el.scrollTop > 0));
  await page.screenshot({
    path: `/tmp/rah-composer-autosize-${await editor.getAttribute("aria-label")}-${width}.png`,
  });
  await editor.fill("Short again");
  await expect
    .poll(() => editor.evaluate((el) => el.getBoundingClientRect().height))
    .toBeGreaterThanOrEqual(minimum);
  assert.ok(
    await editor.evaluate(
      (el, max) => el.getBoundingClientRect().height <= max,
      Math.max(minimum, 21),
    ),
    "short content shrinks back to the minimum or native one-line height",
  );
  await expect(editor).toHaveCSS("overflow-y", "hidden");
  await editor.fill("");
}
