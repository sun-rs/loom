import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
assert.equal(process.env.RAH_GUIDE_FORMAL, "1");
const state = process.env.RAH_STATE_DIRECTORY,
  directory = process.env.RAH_GUIDE_EVIDENCE;
assert.ok(state && directory);
const db = new DatabaseSync(`${state}/room.db`, { readOnly: true });
try {
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS n FROM activations WHERE state NOT IN ('completed','cancelled','failed')",
      )
      .get().n,
    0,
  );
} finally {
  db.close();
}
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let original;
async function command(path, body) {
  return page.evaluate(
    async ({ path, body }) => {
      const r = await fetch(`/v3/client/runtime-guide/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    { path, body },
  );
}
try {
  await page.goto(
    "http://127.0.0.1:4173/?surface=settings&settingsSection=administration",
  );
  await page
    .getByRole("region", { name: "Claude Code", exact: true })
    .waitFor();
  original = (await command("read", {})).runtimes.find(
    (r) => r.runtimeId === "claude",
  );
  for (const name of ["Codex", "Claude Code"]) {
    const card = page.getByRole("region", { name, exact: true });
    await card.locator("summary").click();
    const text = await card.locator(".rah-runtime-launch-fixed").innerText();
    if (name === "Codex") {
      assert.match(text, /app-server/);
      assert.match(text, /features.memories=false/);
      assert.match(text, /memories.generate_memories=false/);
      assert.match(text, /memories.use_memories=false/);
    } else {
      assert.match(text, /--verbose/);
      assert.match(text, /CLAUDE_CODE_DISABLE_AUTO_MEMORY=1/);
    }
    assert.equal(
      await card
        .getByRole("button", { name: "与默认对比", exact: true })
        .count(),
      0,
    );
  }
  const card = page.getByRole("region", { name: "Claude Code", exact: true });
  const editor = card.getByRole("textbox", { name: "claude 附加参数" });
  await editor.fill('--debug "api"');
  await card.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('textarea[aria-label="claude 附加参数"]').value ===
        "--debug api" &&
      !document.querySelector('textarea[aria-label="claude 附加参数"]')
        .disabled,
  );
  assert.equal(
    await card.getByRole("button", { name: "保存", exact: true }).isDisabled(),
    true,
  );
  await page.reload();
  await card.locator("summary").click();
  assert.equal(await editor.inputValue(), "--debug api");
  assert.deepEqual(
    (await command("read", {})).runtimes.find((r) => r.runtimeId === "claude")
      .additionalArgs,
    ["--debug", "api"],
  );
  await card.getByRole("button", { name: "清空附加参数", exact: true }).click();
  await card.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector('textarea[aria-label="claude 附加参数"]')
        .disabled,
  );
  assert.deepEqual(
    (await command("read", {})).runtimes.find((r) => r.runtimeId === "claude")
      .additionalArgs,
    [],
  );
  assert.equal(
    await card.getByRole("button", { name: "保存", exact: true }).isDisabled(),
    true,
  );
  await page.screenshot({
    path: `${directory}/formal-runtime-guide-desktop.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: `${directory}/formal-runtime-guide-mobile.png`,
    fullPage: true,
    animations: "disabled",
  });
  console.log(
    "Formal Chrome: fixed parameters/environment visible, additions save/reload/clear, disabled saved button, desktop/mobile passed.",
  );
} finally {
  if (original) {
    const current = await command("read", {});
    await command("update", {
      runtimeId: "claude",
      expectedRevision: current.revision,
      ...(original.overrideArgs !== null
        ? { overrideArgs: original.overrideArgs }
        : { additionalArgs: original.additionalArgs }),
    });
  }
  await browser.close();
}
