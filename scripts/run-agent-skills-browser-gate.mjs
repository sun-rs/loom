import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";

const output = mkdtempSync(join(tmpdir(), "rah-agent-skills-browser-"));
const codexHome = join(output, "codex-home");
const skillDir = join(codexHome, "skills", "fixture-global");
mkdirSync(skillDir, { recursive: true });
writeFileSync(
  join(skillDir, "SKILL.md"),
  "---\nname: Isolated Fixture Skill\ndescription: Real metadata from the isolated provider directory\nuser-invocable: true\n---\nBODY_MUST_NOT_REACH_BROWSER",
);
process.env.CODEX_HOME = codexHome;
const results = [];
for (const engine of ["chrome", "firefox"]) {
  const fixture = await startShellFixture();
  const browser = await (engine === "chrome" ? chromium : firefox).launch({
    headless: true,
    ...(engine === "chrome"
      ? { executablePath: await findChromeExecutable() }
      : {}),
  });
  try {
    const page = await browser.newPage({ serviceWorkers: "block" });
    page.setDefaultTimeout(10_000);
    await page.addInitScript(() =>
      localStorage.setItem("rah:web-push-desired:v1", "disabled"),
    );
    const post = async (path, data) => {
      const response = await page.request.post(
        `${fixture.origin}/v3/client/${path}`,
        { data },
      );
      assert.equal(response.status(), 200, await response.text());
      return response.json();
    };
    const workspace = (await post("workspaces/list", {})).workspaces[0];
    const agents = (
      await post("agents/list", { controlRoomId: workspace.controlRoomId })
    ).agents;
    const id = agents[0].definition.agentId;
    const seed = await post("agents/get", { agentId: id });
    const frontier = await post("rooms/sync", {
      roomId: workspace.controlRoomId,
      consumerId: "skills-gate-seed",
      bootstrap: "latest",
    });
    await post("agents/manage", {
      action: "configure",
      agentId: id,
      handle: seed.agent.handle,
      displayName: seed.agent.currentRevision.displayName ?? seed.agent.handle,
      role: seed.agent.currentRevision.role,
      instructions: "Isolated Skills gate Agent; preserve this instruction.",
      runtimeOfferId: seed.policy.required.allowedOfferIds[0],
      modelIntent: seed.policy.modelIntent,
      toolAccessMode: "full_access",
      basedOnRoomSeq: frontier.latestRoomSeq,
      idempotencyKey: crypto.randomUUID(),
    });
    const initialSkills = await post("agents/skills/list", {
      agentId: id,
    });
    writeFileSync(
      join(output, `${engine}-initial-skills.json`),
      JSON.stringify(initialSkills, null, 2),
    );
    assert.equal(
      initialSkills.global.skills[0]?.displayName,
      "Isolated Fixture Skill",
      JSON.stringify(initialSkills),
    );
    const target = `${fixture.origin}/?surface=agents&agent=${id}&agentTab=profile`;
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto(target);
      const skills = page.getByRole("region", { name: "技能", exact: true });
      await skills
        .getByText("Isolated Fixture Skill", { exact: true })
        .waitFor()
        .catch(async (error) => {
          writeFileSync(
            join(output, `${engine}-${width}-failure.txt`),
            await page.locator("body").innerText(),
          );
          await page.screenshot({
            path: join(output, `${engine}-${width}-failure.png`),
          });
          console.error(output);
          throw error;
        });
      assert.match(await skills.innerText(), /全局.*1/s);
      assert.match(await skills.innerText(), /工作区.*0/s);
      assert.match(await skills.innerText(), /此 Agent 工作区内暂无 skill/);
      assert.ok(
        !(await skills.innerText()).includes("BODY_MUST_NOT_REACH_BROWSER"),
      );
      assert.equal(
        await skills
          .locator(".rah-agent-skill-command")
          .evaluate((element) => getComputedStyle(element).backgroundColor),
        "rgb(169, 216, 119)",
        "Raft current --color-brutal-lime command badge",
      );
      await skills.scrollIntoViewIfNeeded();
      const globalIcon = skills
        .locator(".rah-agent-skills-scope")
        .first()
        .locator("h4 svg");
      const globalHref = await globalIcon.locator("use").getAttribute("href");
      const iconAsset = await page.request.get(
        new URL(globalHref.split("#")[0], fixture.origin).href,
      );
      assert.ok((await iconAsset.text()).includes('id="raft-icon-globe"'));
      const card = skills.locator(".rah-agent-skill-list article").first();
      await card.hover();
      const expectedBlack = await card.evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--black)";
        element.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      await page.waitForFunction(
        ({ element, expected }) =>
          getComputedStyle(element).borderTopColor === expected,
        { element: await card.elementHandle(), expected: expectedBlack },
      );
      await page.mouse.move(1, 1);
      await page.screenshot({
        path: join(output, `${engine}-${width}-skills.png`),
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        width,
      );
      let requestCount = 0;
      let failReads = true;
      await page.route("**/v3/client/agents/skills/list", async (route) => {
        requestCount++;
        if (failReads)
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "unavailable",
                message: "Isolated Skills read failure",
              },
            }),
          });
        return route.continue();
      });
      await page.reload();
      await skills.getByRole("alert").waitFor();
      const failedReads = requestCount;
      assert.ok(failedReads >= 1);
      failReads = false;
      await skills.getByRole("button", { name: "重试", exact: true }).click();
      await skills
        .getByText("Isolated Fixture Skill", { exact: true })
        .waitFor();
      assert.equal(requestCount, failedReads + 1);
      await page.unroute("**/v3/client/agents/skills/list");
      const beforeSwitch = await post("agents/get", { agentId: id });
      let releaseOld;
      const oldWait = new Promise((resolve) => {
        releaseOld = resolve;
      });
      let sawOld = false;
      let sawNew = false;
      await page.route("**/v3/client/agents/skills/list", async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        if (
          data.executionPolicyRevisionId ===
          beforeSwitch.policy.executionPolicyRevisionId
        ) {
          sawOld = true;
          data.global.skills[0].displayName = "STALE CLI SKILL MUST NOT APPEAR";
          await oldWait;
          await route.fulfill({ response, json: data }).catch(() => {});
        } else {
          sawNew = true;
          await route.fulfill({ response });
        }
      });
      await page.reload();
      await skills.getByText("正在加载技能…", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "编辑运行时配置", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "编辑运行时配置",
        exact: true,
      });
      await dialog.getByRole("button", { name: /^运行时：/ }).click();
      await page
        .locator('[role="menuitemradio"][aria-checked="false"]:not(:disabled)')
        .first()
        .click();
      await dialog
        .getByRole("button", { name: "保存运行时配置", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      await skills
        .getByText("Isolated Fixture Skill", { exact: true })
        .waitFor();
      assert.ok(
        sawOld && sawNew,
        "Both old and new policy requests must have reached real daemon reads",
      );
      releaseOld();
      await page.waitForTimeout(100);
      assert.ok(!(await skills.innerText()).includes("STALE CLI"));
      const afterSwitch = await post("agents/get", { agentId: id });
      assert.notEqual(
        afterSwitch.policy.executionPolicyRevisionId,
        beforeSwitch.policy.executionPolicyRevisionId,
      );
      assert.notDeepEqual(
        afterSwitch.policy.required.allowedOfferIds,
        beforeSwitch.policy.required.allowedOfferIds,
      );
      await page.unroute("**/v3/client/agents/skills/list");
      const currentSkills = await post("agents/skills/list", {
        agentId: id,
      });
      const unavailable = {
        state: "unavailable",
        skills: [],
        truncated: false,
        issues: ["unsupported_runtime"],
      };
      await page.route("**/v3/client/agents/skills/list", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...currentSkills,
            cliId: "kimi",
            global: unavailable,
            workspace: unavailable,
          }),
        }),
      );
      await page.reload();
      await skills
        .getByText("当前 CLI 的技能目录读取尚未接入。", { exact: true })
        .first()
        .waitFor();
      assert.ok(!(await skills.innerText()).includes("暂无"));
      assert.ok(!(await skills.innerText()).includes("(0)"));
      await page.unroute("**/v3/client/agents/skills/list");
      results.push({
        engine,
        width,
        realMetadata: true,
        emptyWorkspace: true,
        retry503: true,
        loading: true,
        lateRuntimeResponse: true,
        unavailableUiFixture: true,
        pointerHover: true,
      });
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
}
writeFileSync(
  join(output, "receipt.json"),
  JSON.stringify({ fixture: true, results }, null, 2),
);
console.log(
  `RAH_AGENT_SKILLS_BROWSER_GATE ${JSON.stringify({ output, results })}`,
);
