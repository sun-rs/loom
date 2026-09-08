import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "playwright";

import {
  classifyFormalBrowserRequest,
  parseFormalBrowserTarget,
} from "./formal-browser-request-policy.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";

const { databasePath, origin } = parseFormalBrowserTarget(process.env);
const output = mkdtempSync(join(tmpdir(), "rah-discovery-formal-"));
const requiredDiscoveryRequests = [
  "GET /v3/client/health",
  "POST /v3/client/workspaces/list",
  "POST /v3/client/tasks/global",
  "POST /v3/client/search",
  "POST /v3/client/messages/social",
];
const sha256File = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

function canonicalSnapshot() {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const counts = Object.fromEntries(
      [
        "principals",
        "rooms",
        "messages",
        "tasks",
        "task_reviews",
        "task_submissions",
        "message_reactions",
        "human_saved_messages",
        "room_events",
      ].map((table) => [
        table,
        Number(
          database.prepare(`SELECT count(*) AS count FROM ${table}`).get()
            .count,
        ),
      ]),
    );
    const maximumRoomSequences = database
      .prepare(
        "SELECT room_id AS roomId, max(room_seq) AS sequence FROM room_events GROUP BY room_id ORDER BY room_id",
      )
      .all()
      .map(({ roomId, sequence }) => ({
        roomId,
        sequence: Number(sequence),
      }));
    const readState = Object.fromEntries(
      ["human_activity_frontiers", "subscription_cursors"].map((table) => {
        const rows = database
          .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
          .all();
        return [
          table,
          {
            count: rows.length,
            sha256: createHash("sha256")
              .update(JSON.stringify(rows))
              .digest("hex"),
          },
        ];
      }),
    );
    return { content: { counts, maximumRoomSequences }, readState };
  } finally {
    database.close();
  }
}

function screenshotManifest() {
  const entries = readdirSync(output)
    .filter((name) => name.endsWith(".png"))
    .sort()
    .map((name) => ({
      name,
      sha256: createHash("sha256")
        .update(readFileSync(join(output, name)))
        .digest("hex"),
    }));
  return {
    count: entries.length,
    sha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
  };
}

async function readBuildIdentity() {
  const response = await fetch(`${origin}/`);
  assert.equal(response.ok, true, `Workbench unavailable: ${response.status}`);
  const html = await response.text();
  const advertised = response.headers.get("x-rah-web-build-id");
  const embedded = html.match(
    /<meta\s+name=["']rah-web-build-id["']\s+content=["']([^"']+)["']/u,
  )?.[1];
  assert.ok(advertised, "Missing x-rah-web-build-id response header");
  assert.equal(embedded, advertised, "Served HTML and response header differ");
  return advertised;
}

async function verifyTasks(page, engine) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/?surface=tasks`, { waitUntil: "networkidle" });
  const surface = page.getByRole("main", { name: "全局任务" });
  await surface.waitFor();
  await surface.getByRole("heading", { name: "任务", exact: true }).waitFor();
  const creator = surface.getByRole("button", {
    name: "创建者",
    exact: true,
  });
  await creator.click();
  const menu = page.getByRole("menu", { name: "创建者筛选" });
  await menu.waitFor();
  const search = menu.getByRole("textbox", { name: "搜索创建者" });
  assert.equal(
    await search.evaluate((element) => getComputedStyle(element).borderWidth),
    "2px",
  );
  assert.equal(
    await menu
      .getByRole("menuitemcheckbox", { name: "我创建的", exact: true })
      .locator(".rah-agent-avatar, .rah-settings-avatar")
      .count(),
    0,
    "Raft's self sentinel must not invent an avatar",
  );
  const agentAvatar = menu.locator(".rah-agent-avatar").first();
  await agentAvatar.waitFor();
  assert.ok(
    (await menu.locator(".rah-agent-avatar").count()) >= 1,
    "real Agent filter rows must consume canonical avatar identity",
  );
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  assert.equal(
    await creator.evaluate((element) => document.activeElement === element),
    true,
    "Escape returns focus to the Task filter trigger",
  );
  const list = surface.getByRole("radio", { name: "列表", exact: true });
  await list.click();
  assert.equal(await list.getAttribute("aria-checked"), "true");
  assert.equal(new URL(page.url()).searchParams.get("view"), "list");
  await page.screenshot({
    path: join(output, `${engine}-formal-tasks-1440.png`),
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/?surface=tasks`, { waitUntil: "networkidle" });
  await page.getByRole("main", { name: "全局任务" }).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "mobile Tasks cannot overflow the viewport",
  );
  await page.screenshot({
    path: join(output, `${engine}-formal-tasks-390.png`),
  });
}

async function verifySearch(page, engine) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/?surface=search`, { waitUntil: "networkidle" });
  const query = page.getByRole("textbox", {
    name: "搜索频道、私信、消息",
  });
  await query.fill(`no-result-${engine}-formal-rah-contract`);
  const noResult = page.locator(
    '.rah-empty-state[data-context="search"][data-placement="section"]',
  );
  await noResult
    .getByText(`没有找到“${await query.inputValue()}”的结果`, { exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".search-stage").getByText("0", { exact: true }).count(),
    0,
    "a zero-length JSX branch cannot leak a numeric zero",
  );
  assert.equal(
    await page.locator(".search-stage > .empty-state").count(),
    0,
    "formal Search must consume the shared EmptyState owner",
  );
  await page.screenshot({
    path: join(output, `${engine}-formal-search-empty-1440.png`),
  });
}

async function verifyMessageActions(page, engine) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin, { waitUntil: "networkidle" });
  // The formal Room has older rows above the scroll viewport. Use the newest
  // rendered row so auto-scroll cannot immediately steal :hover after a
  // synthetic scroll to an old message.
  const message = page.locator(".msg:has(.msg-actions)").last();
  await message.waitFor();
  const actions = message.locator(".msg-actions");
  assert.equal(
    await actions.evaluate((element) => getComputedStyle(element).opacity),
    "0",
  );
  await message.hover();
  await page.waitForFunction(
    (messageId) =>
      getComputedStyle(
        document.querySelector(
          `[data-message-id="${CSS.escape(messageId)}"] .msg-actions`,
        ),
      ).opacity === "1",
    await message.getAttribute("data-message-id"),
  );
  assert.equal(await actions.getByRole("button").count(), 3);
  for (const button of await actions.getByRole("button").all()) {
    const box = await button.boundingBox();
    assert.deepEqual([box.width, box.height], [24, 24]);
  }
  await actions.getByRole("button", { name: "添加回应" }).click();
  const reactions = page.getByRole("menu", { name: "添加回应筛选" });
  await reactions.waitFor();
  assert.equal(await reactions.getByRole("menuitemradio").count(), 7);
  await page.keyboard.press("Escape");
  await reactions.waitFor({ state: "detached" });
  await page.screenshot({
    path: join(output, `${engine}-formal-message-actions-1440.png`),
  });
}

const before = canonicalSnapshot();
const receipt = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  origin,
  database: basename(databasePath),
  webBuildId: await readBuildIdentity(),
  evidenceInputs: {
    runnerSha256: sha256File(fileURLToPath(import.meta.url)),
    requestPolicySha256: sha256File(
      fileURLToPath(
        new URL("./formal-browser-request-policy.mjs", import.meta.url),
      ),
    ),
  },
  before,
  results: [],
  output,
};

for (const engine of ["chrome", "firefox"]) {
  const browser =
    engine === "chrome"
      ? await chromium.launch({
          executablePath: await findChromeExecutable(),
          headless: true,
        })
      : await firefox.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  const rejectedRequests = [];
  const observedApiRequests = new Map();
  const observedReadStateRequests = new Map();
  page.on("pageerror", (error) => errors.push(`page: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`response: ${response.status()} ${response.url()}`);
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const result = classifyFormalBrowserRequest({
      method: request.method(),
      origin,
      url: request.url(),
    });
    if (
      result.decision === "allow-api" ||
      result.decision === "allow-read-state"
    ) {
      const observations =
        result.decision === "allow-api"
          ? observedApiRequests
          : observedReadStateRequests;
      observations.set(
        result.identity,
        (observations.get(result.identity) ?? 0) + 1,
      );
      return route.continue();
    }
    if (result.decision === "allow-static") return route.continue();
    rejectedRequests.push(`${result.identity} (${result.reason})`);
    return route.abort();
  });
  try {
    await verifyTasks(page, engine);
    await verifySearch(page, engine);
    await verifyMessageActions(page, engine);
    for (const identity of requiredDiscoveryRequests)
      assert.ok(
        (observedApiRequests.get(identity) ?? 0) > 0,
        `Required request was not observed: ${identity}`,
      );
    assert.deepEqual(rejectedRequests, [], "Unexpected API request");
    assert.deepEqual(errors, [], "Browser errors detected");
    receipt.results.push({
      engine,
      version: browser.version(),
      status: "passed",
      surfaces: ["tasks", "search", "messages"],
      viewports: [1440, 390],
      observedApiRequests: Object.fromEntries(
        [...observedApiRequests].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      observedReadStateRequests: Object.fromEntries(
        [...observedReadStateRequests].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      rejectedRequests,
      errors,
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

receipt.finishedAt = new Date().toISOString();
receipt.after = canonicalSnapshot();
assert.deepEqual(
  receipt.after.content,
  receipt.before.content,
  "Canonical collaboration content changed",
);
receipt.readStateChanged =
  JSON.stringify(receipt.after.readState) !==
  JSON.stringify(receipt.before.readState);
receipt.screenshots = screenshotManifest();
assert.equal(receipt.screenshots.count, 8, "Expected eight formal captures");
writeFileSync(
  join(output, "receipt.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
