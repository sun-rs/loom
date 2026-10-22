// Exercise the official popup with real pointer actions, including portalled menus.
export async function chooseOption(page, scope, label, choice) {
  await scope
    .getByRole("combobox", {
      name: new RegExp("^" + RegExp.escape(label) + "\\s*\\*?$"),
    })
    .click();
  const options = page.getByRole("listbox").getByRole("option");
  await (
    typeof choice === "number"
      ? options.nth(choice)
      : page.getByRole("option", { name: choice, exact: true })
  ).click();
  await page.getByRole("listbox").waitFor({ state: "hidden" });
}
