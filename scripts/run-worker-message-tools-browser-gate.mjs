import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const output = mkdtempSync(join(tmpdir(), "rah-worker-tools-browser-"));
process.env.RAH_FIXTURE_MESSAGE_TOOLS = "1";
for (const engine of ["chrome", "firefox"]) {
  const fixture = await startShellFixture();
  const browser = await (engine === "chrome" ? chromium : firefox).launch({
    headless: true,
    ...(engine === "chrome"
      ? { executablePath: await findChromeExecutable() }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  try {
    const post = async (path, data) => {
      const r = await page.request.post(fixture.origin + "/v3/client/" + path, {
        data,
      });
      assert.equal(r.status(), 200, await r.text());
      return r.json();
    };
    const workspace = (await post("workspaces/list", {})).workspaces[0];
    const agent = (
      await post("agents/list", { controlRoomId: workspace.controlRoomId })
    ).agents[0];
    const sync = await post("rooms/sync", {
      roomId: fixture.roomId,
      consumerId: "tools-browser",
      bootstrap: "latest",
    });
    const posted = await post("messages/post", {
      roomId: fixture.roomId,
      basedOnRoomSeq: sync.latestRoomSeq,
      body: "[WORKER-TOOLS] isolated CLI search and reaction",
      idempotencyKey: crypto.randomUUID(),
      recipients: [
        { participantId: agent.definition.participantId, reason: "mention" },
      ],
    });
    const messageId = posted.event.aggregateId;
    let item;
    for (let i = 0; i < 200; i++) {
      item = (
        await post("messages/social", {
          roomId: fixture.roomId,
          messageIds: [messageId],
        })
      ).items[0];
      if (item.reactions.length) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(item.reactions[0]?.count, 1);
    assert.equal(
      item.reactions[0]?.actors[0]?.principalId,
      agent.definition.participantId,
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto(fixture.origin + `/?room=${fixture.roomId}`);
      const reaction = page
        .locator(`[data-message-id="${messageId}"] .rah-message-reaction`)
        .first();
      await reaction.waitFor();
      assert.equal(
        await reaction.locator(".rah-message-reaction-count").textContent(),
        "1",
      );
      await page.screenshot({ path: join(output, `${engine}-${width}.png`) });
    }
    writeFileSync(
      join(output, `${engine}.json`),
      JSON.stringify({ messageId, item, status: "passed" }, null, 2),
    );
  } catch (error) {
    await page.screenshot({ path: join(output, `${engine}-failure.png`) });
    console.error(output);
    throw error;
  } finally {
    await browser.close();
    await fixture.close();
  }
}
delete process.env.RAH_FIXTURE_MESSAGE_TOOLS;
console.log(JSON.stringify({ output, status: "passed" }));
