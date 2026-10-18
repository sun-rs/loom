import assert from "node:assert/strict";
import { chooseOption } from "./select-browser.mjs";
export async function verifyRoleModelLabels({ browser, origin }) {
  const results = [];
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.route("**/v1/local/runtimes/list", async (route) => {
      const response = await route.fetch(),
        body = await response.json();
      body.runtimes = body.runtimes
        .slice(0, 1)
        .map((r) => ({
          ...r,
          modelBindingDescriptors: ["vendor-a/shared", "vendor-b/shared"].map(
            (id) => ({
              ...r.modelBindingDescriptors[0],
              modelId: id,
              modelBindingId: "local:codex-cli/v1:" + id,
              displayName: "Shared Model",
            }),
          ),
        }));
      await route.fulfill({ response, json: body });
    });
    await page.goto(origin + "/?view=agents");
    await page.getByRole("button", { name: "新建角色", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await chooseOption(page, dialog, "CLI", 0);
    await dialog.getByRole("combobox", { name: "模型", exact: true }).click();
    const options = page.getByRole("listbox").getByRole("option");
    await options.first().waitFor();
    assert.deepEqual(await options.allTextContents(), [
      "Shared Model · vendor-a/shared",
      "Shared Model · vendor-b/shared",
    ]);
    await options.nth(1).click();
    await page.keyboard.press("Escape");
    results.push({ width, ambiguousModelsDistinguishable: true });
    await page.close();
  }
  return results;
}
