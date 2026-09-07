import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox } from "playwright";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
import { classifyFoundationBrowserRequest } from "./foundation-browser-request-policy.mjs";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { verifyHumanMembershipInteractions } from "./ui-human-membership-browser-scenarios.mjs";
import {
  snapshotUiEvidenceInputs,
  assertUiEvidenceInputSnapshot,
  uiContractEvidenceInputPaths,
} from "./ui-evidence-inputs.mjs";

const output = mkdtempSync(join(tmpdir(), "rah-human-membership-"));
const receipt = {
  output,
  inputs: snapshotUiEvidenceInputs({
    extraPaths: uiContractEvidenceInputPaths(),
  }),
  results: [],
};
try {
  const engines = process.env.RAH_UI_BROWSER
    ? [process.env.RAH_UI_BROWSER]
    : ["chrome", "firefox"];
  for (const { engine, revokeTo } of engines.flatMap((engine) =>
    ["admin", "member"].map((revokeTo) => ({ engine, revokeTo })),
  )) {
    const fixture = await startShellFixture({ humanMatrix: true });
    const browser =
      engine === "chrome"
        ? await chromium.launch({
            headless: true,
            executablePath: await findChromeExecutable(),
          })
        : await firefox.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await page.route("**/*", async (route) => {
      const request = route.request();
      const decision = classifyFoundationBrowserRequest({
        fixtureOrigin: fixture.origin,
        harnessOrigin: fixture.origin,
        method: request.method(),
        url: request.url(),
      });
      const roleMutation =
        request.method() === "POST" &&
        request.url() === `${fixture.origin}/v3/client/rooms/members/role`;
      if (decision.decision === "reject" && !roleMutation) {
        pageErrors.push(
          `Blocked unexpected request: ${request.method()} ${new URL(request.url()).pathname}`,
        );
        await route.abort();
      } else await route.continue();
    });
    const scenario = async (id, run) => {
      console.log(`Human membership: ${engine} ${revokeTo} ${id}`);
      await run();
      receipt.results.push({
        engine,
        revokeTo,
        scenario: id,
        status: "passed",
      });
    };
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(30_000);
    await page.addInitScript(() =>
      localStorage.setItem("rah:web-push-desired:v1", "disabled"),
    );
    const post = async (path, data, status = 200) => {
      const response = await page.request.post(
        `${fixture.origin}/v3/client/${path}`,
        { data },
      );
      assert.equal(
        response.status(),
        status,
        `${path}: ${await response.text()}`,
      );
      return response.json();
    };
    try {
      await scenario("human-membership-authority", async () => {
        await page.goto(`${fixture.origin}/?surface=agents`, {
          waitUntil: "load",
        });
        const directory = page.locator(".rah-agent-human-section");
        await page.waitForFunction(
          () =>
            document.querySelectorAll(".rah-agent-human-section button")
              .length === 3,
        );
        const workspaces = await post("workspaces/list", {});
        const workspace = workspaces.workspaces[0];
        const humans = (
          await post("workspaces/humans", {
            workspaceId: workspace.workspaceId,
          })
        ).humans;
        const colleague = humans.find(
          (x) => x.principal.handle === "fixture-colleague",
        ).principal;
        const actor = humans.find(
          (x) => x.principal.handle === "sun",
        ).principal;
        const roleWrite = async (principalId, role, status = 200) => {
          const sync = await post("rooms/sync", {
            roomId: workspace.controlRoomId,
            consumerId: `membership-${engine}`,
            limit: 500,
          });
          return post(
            "rooms/members/role",
            {
              roomId: workspace.controlRoomId,
              principalId,
              role,
              basedOnRoomSeq: sync.latestRoomSeq,
              idempotencyKey: `membership-${engine}-${crypto.randomUUID()}`,
            },
            status,
          );
        };
        await directory
          .getByRole("button")
          .filter({ hasText: "Fixture colleague /" })
          .click();
        const panel = page.getByRole("region", { name: "Human 详情" });
        const edit = panel.getByRole("button", {
          name: "编辑角色",
          exact: true,
        });
        await edit.waitFor();
        assert.equal(
          await panel
            .getByRole("button", { name: "编辑描述", exact: true })
            .count(),
          0,
        );
        if (revokeTo === "member")
          await verifyHumanMembershipInteractions({
            page,
            origin: fixture.origin,
            workspace,
            humans,
            post,
            roleWrite,
            output,
            engine,
          });
        // Actual canonical demotion, while the other Human's editor remains open.
        await page.setViewportSize({ width: 1440, height: 900 });
        await directory
          .getByRole("button")
          .filter({ hasText: "Fixture colleague /" })
          .click();
        await edit.click();
        if (revokeTo === "member")
          await page
            .getByRole("button", { name: "添加 Agent", exact: true })
            .click();
        await roleWrite(actor.principalId, revokeTo);
        await page.waitForFunction(
          (revokeTo) => {
            const button = document.querySelector(
              'button[aria-label="添加 Agent"]',
            );
            return (
              button?.disabled === (revokeTo === "member") &&
              !document.querySelector(".rah-profile-role-editor") &&
              (revokeTo !== "member" ||
                !document.querySelector(".rah-agent-create-menu"))
            );
          },
          revokeTo,
          { timeout: 8000 },
        );
        assert.equal(
          await edit.count(),
          0,
          "lost authority removes the edit action",
        );
        await roleWrite(colleague.principalId, "admin", 403);
        await page.screenshot({
          path: join(output, `${engine}-${revokeTo}-revoked.png`),
        });
        assert.deepEqual(pageErrors, []);
      });
    } catch (error) {
      await page.screenshot({
        path: join(output, `${engine}-${revokeTo}-failure.png`),
      });
      throw error;
    } finally {
      await browser.close();
      await fixture.close();
    }
  }
  assertUiEvidenceInputSnapshot(receipt.inputs, {
    extraPaths: uiContractEvidenceInputPaths(),
  });
} catch (error) {
  receipt.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(
    JSON.stringify({ output, results: receipt.results, error: receipt.error }),
  );
}
