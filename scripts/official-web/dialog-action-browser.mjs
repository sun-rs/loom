// Fixture-only geometry assertions; official recipes own row/stack/sheet layout.
import assert from "node:assert/strict";
export async function assertDialogActionOrder({
  page,
  dialog,
  width,
  saveName,
  screenshot,
}) {
  const footer = dialog.locator('[data-slot="dialog-footer"]').last();
  const save = dialog.getByRole("button", { name: saveName, exact: true });
  if (width === 390) {
    assert.equal(await footer.isVisible(), false, "native sheet hides footer");
    const close = dialog.getByRole("button", { name: "关闭", exact: true });
    const [c, s] = await Promise.all([close.boundingBox(), save.boundingBox()]);
    assert.ok(
      c.x < s.x && Math.abs(c.y + c.height / 2 - s.y - s.height / 2) < 4,
      "sheet: close left, commit right, native unequal button heights share a centre: " +
        JSON.stringify({ c, s }),
    );
  } else {
    const cancel = footer.getByRole("button", { name: "取消", exact: true });
    assert.deepEqual(await footer.locator("button").allTextContents(), [
      "取消",
      saveName,
    ]);
    const [c, s] = await Promise.all([
      cancel.boundingBox(),
      save.boundingBox(),
    ]);
    assert.ok(
      c.x < s.x && Math.abs(c.y - s.y) < 4,
      "row: cancel left, commit right",
    );
    // Force native overflow in this disposable DOM only, without changing product CSS.
    await footer.evaluate((el) => {
      el.style.width = "120px";
    });
    await page.waitForFunction(() =>
      document.querySelector('[data-slot="dialog-footer"][data-stacked]'),
    );
    const [stackCancel, stackSave] = await Promise.all([
      cancel.boundingBox(),
      save.boundingBox(),
    ]);
    assert.ok(stackSave.y < stackCancel.y, "native stack: commit above cancel");
    await footer.evaluate((el) => {
      el.style.removeProperty("width");
    });
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-slot="dialog-footer"][data-stacked]'),
    );
  }
  await page.screenshot({ path: screenshot });
}
