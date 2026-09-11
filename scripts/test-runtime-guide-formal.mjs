import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
if (process.env.RAH_GUIDE_FORMAL !== "1")
  throw new Error(
    "Set RAH_GUIDE_FORMAL=1 for the idle formal workbench verification",
  );
const state = process.env.RAH_STATE_DIRECTORY;
assert.ok(state, "RAH_STATE_DIRECTORY is required");
const db = new DatabaseSync(`${state}/room.db`, { readOnly: true });
try {
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS n FROM activations WHERE state NOT IN ('completed','cancelled','failed')",
      )
      .get().n,
    0,
    "Formal workbench must be idle before changing Guide settings",
  );
} finally {
  db.close();
}
const directory = process.env.RAH_GUIDE_EVIDENCE;
assert.ok(directory, "RAH_GUIDE_EVIDENCE is required");
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let restore;
try {
  await page.goto(
    "http://127.0.0.1:4173/?surface=settings&settingsSection=administration",
  );
  const codex = page.getByRole("checkbox", {
    name: "Codex Guide",
    exact: true,
  });
  await codex.waitFor();
  if (process.env.RAH_GUIDE_ENABLE_SUPPORTED === "1") {
    for (const name of ["Codex Guide", "Claude Code Guide"]) {
      const box = page.getByRole("checkbox", { name, exact: true });
      if (!(await box.isChecked())) {
        await box.click();
        await page.waitForFunction((label) => {
          const input = document.querySelector(`input[aria-label="${label}"]`);
          return input?.checked && !input.disabled;
        }, name);
      }
    }
  }
  restore = await codex.isChecked();
  await codex.click();
  await page.waitForFunction(
    (expected) =>
      document.querySelector('input[aria-label="Codex Guide"]')?.checked ===
        expected &&
      !document.querySelector('input[aria-label="Codex Guide"]')?.disabled,
    !restore,
  );
  await page.reload();
  await codex.waitFor();
  assert.equal(
    await codex.isChecked(),
    !restore,
    "Reload reads durable daemon setting",
  );
  const saved = JSON.parse(
    await readFile(`${state}/runtime-guide.json`, "utf8"),
  );
  assert.equal(saved.enabled.includes("codex"), !restore);
  await codex.click();
  await page.waitForFunction(
    (expected) =>
      document.querySelector('input[aria-label="Codex Guide"]')?.checked ===
        expected &&
      !document.querySelector('input[aria-label="Codex Guide"]')?.disabled,
    restore,
  );
  assert.equal(
    await page
      .getByRole("checkbox", { name: "Kimi Guide", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("checkbox", { name: "OpenCode Guide", exact: true })
      .isDisabled(),
    true,
  );
  await page.screenshot({
    path: `${directory}/formal-runtime-guide-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await codex.waitFor();
  assert.equal(await codex.isChecked(), restore);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: `${directory}/formal-runtime-guide-mobile.png`,
    fullPage: true,
  });
  console.log(
    "Formal Chrome: authenticated settings, pointer toggle, reload, durable file, disabled adapters, restored original preference, desktop/mobile passed.",
  );
} finally {
  if (restore !== undefined) {
    await page.evaluate(async (enabled) => {
      const send = (path, body) =>
        fetch(`/v3/client/runtime-guide/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      const current = await (await send("read", {})).json();
      if (
        current.runtimes?.find((row) => row.runtimeId === "codex")?.enabled !==
        enabled
      ) {
        const result = await send("update", {
          runtimeId: "codex",
          enabled,
          expectedRevision: current.revision,
        });
        if (!result.ok) throw new Error("Could not restore Guide preference");
      }
    }, restore);
  }
  await browser.close();
}
