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
  requiredFormalBrowserRequests,
} from "./formal-browser-request-policy.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
import { verifySettingsNavigation } from "./ui-settings-family-browser-scenarios.mjs";

const { databasePath, origin } = parseFormalBrowserTarget(process.env);
const output = mkdtempSync(join(tmpdir(), "rah-settings-formal-"));
const sha256File = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

function canonicalSnapshot() {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const counts = Object.fromEntries(
      ["principals", "rooms", "messages", "tasks", "room_events"].map(
        (table) => [
          table,
          Number(
            database.prepare(`SELECT count(*) AS count FROM ${table}`).get()
              .count,
          ),
        ],
      ),
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
  const sha256 = createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex");
  return { count: entries.length, sha256 };
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

const before = canonicalSnapshot();
const webBuildId = await readBuildIdentity();
const receipt = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  origin,
  database: basename(databasePath),
  webBuildId,
  evidenceInputs: {
    runnerSha256: sha256File(fileURLToPath(import.meta.url)),
    requestPolicySha256: sha256File(
      fileURLToPath(
        new URL("./formal-browser-request-policy.mjs", import.meta.url),
      ),
    ),
    requestPolicyTestSha256: sha256File(
      fileURLToPath(
        new URL("./formal-browser-request-policy.test.mjs", import.meta.url),
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
    await verifySettingsNavigation(page, origin, output, engine);
    for (const identity of requiredFormalBrowserRequests)
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
      sections: 12,
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
assert.equal(receipt.screenshots.count, 48, "Expected 48 Settings captures");
writeFileSync(
  join(output, "receipt.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
