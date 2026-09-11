// Builds docs/design/ui-catalog.html: one self-contained page that documents
// the RAH OS Neo-Brutalist UI with the product's own stylesheets.
//
// Every value on the page is read out of a committed source — never hand
// copied:
//   * CSS            apps/web/src/product-styles.ts import order, resolved and
//                    inlined (fonts become base64 data: URIs);
//   * icons          packages/ui-tokens/src/neo-brutalist/extracted/
//                    raft-icons.svg + packages/ui-tokens/src/
//                    interaction-icons.svg, inlined as hidden symbol sets;
//   * components     packages/ui-tokens/specs/*.spec.json and ratchet.json;
//   * tokens         packages/ui-tokens/src/neo-brutalist/tokens.brutal.css
//                    `:root` custom properties;
//   * docs           docs/design/component-specs/*.zh-CN.md (改动边界 / 挂起);
//   * procedure      .claude/skills/ui-component-spec/SKILL.md steps;
//   * constraints    the six batch-2 constraints in the header comment of
//                    scripts/ui-component-spec.mjs.
//
// When a source is absent the section renders an explicit 未登记 state rather
// than inventing prose. The output is deterministic: no timestamps, no
// randomness, stable key order — building twice produces identical bytes.
//
// Usage: node scripts/build-ui-catalog.mjs [--out <path>] [--check]
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..");

const OUTPUT = "docs/design/ui-catalog.html";
const PRODUCT_STYLES = "apps/web/src/product-styles.ts";
const TOKENS_CSS = "packages/ui-tokens/src/neo-brutalist/tokens.brutal.css";
const SPEC_DIRECTORY = "packages/ui-tokens/specs";
const RATCHET = "packages/ui-tokens/specs/ratchet.json";
const SPEC_DOCS = "docs/design/component-specs";
const SKILL = ".claude/skills/ui-component-spec/SKILL.md";
const CHECKER = "scripts/ui-component-spec.mjs";
const SPRITES = [
  "packages/ui-tokens/src/neo-brutalist/extracted/raft-icons.svg",
  "packages/ui-tokens/src/interaction-icons.svg",
];

const PACKAGE_ALIASES = new Map([
  [
    "@rah-os/ui-tokens/neo-brutalist.css",
    "packages/ui-tokens/src/neo-brutalist/index.css",
  ],
]);

const at = (relativePath) => resolve(ROOT, relativePath);
const readText = (relativePath) => readFileSync(at(relativePath), "utf8");
const exists = (relativePath) => existsSync(at(relativePath));

/* ------------------------------------------------------------------ escape */

export function escapeHtml(value) {
  return String(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

/* --------------------------------------------------------------- css inline */

const FONT_MIME = new Map([
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".ttf", "font/ttf"],
]);

/** Read the ordered stylesheet list out of apps/web/src/product-styles.ts. */
export function productStyleOrder(source = readText(PRODUCT_STYLES)) {
  const order = [];
  for (const match of source.matchAll(/^import\s+"([^"]+)";$/gmu)) {
    const specifier = match[1];
    if (PACKAGE_ALIASES.has(specifier)) {
      order.push(PACKAGE_ALIASES.get(specifier));
      continue;
    }
    if (specifier.startsWith("./")) {
      order.push(`apps/web/src/${specifier.slice(2)}`);
      continue;
    }
    throw new Error(`unresolvable stylesheet import: ${specifier}`);
  }
  if (order.length === 0)
    throw new Error("product-styles.ts listed no stylesheets");
  return order;
}

function inlineUrls(css, fileRelative, fontBytes) {
  return css.replace(/url\(\s*"([^"]+)"\s*\)/gu, (whole, reference) => {
    if (/^(data:|https?:)/u.test(reference)) return whole;
    const target = relative(
      ROOT,
      resolve(at(dirname(fileRelative)), reference),
    );
    if (!exists(target)) return whole;
    const extension = target.slice(target.lastIndexOf("."));
    const mime = FONT_MIME.get(extension);
    if (mime === undefined) return whole;
    const bytes = readFileSync(at(target));
    fontBytes.set(target, bytes.length);
    return `url("data:${mime};base64,${bytes.toString("base64")}")`;
  });
}

/**
 * Inline one stylesheet and everything it @imports, in load order, rewriting
 * font url()s to data: URIs. A file already inlined is skipped: nothing in the
 * product imports the same sheet twice, so dedupe cannot reorder the cascade.
 */
export function inlineStylesheet(fileRelative, seen, fontBytes) {
  if (seen.has(fileRelative)) return "";
  seen.add(fileRelative);
  if (!exists(fileRelative)) return `/* 未登记：${fileRelative} 不存在 */\n`;
  const raw = readText(fileRelative);
  let head = "";
  const body = raw.replace(
    /^@import\s+"([^"]+)";\s*$/gmu,
    (_whole, reference) => {
      const target = relative(
        ROOT,
        resolve(at(dirname(fileRelative)), reference),
      );
      head += inlineStylesheet(target, seen, fontBytes);
      return "";
    },
  );
  return `${head}/* ===== ${fileRelative} ===== */\n${inlineUrls(body, fileRelative, fontBytes)}\n`;
}

export function buildProductCss() {
  const seen = new Set();
  const fontBytes = new Map();
  const order = productStyleOrder();
  let css = "";
  for (const sheet of order) css += inlineStylesheet(sheet, seen, fontBytes);
  return { css, order, files: [...seen], fontBytes };
}

/* ------------------------------------------------------------------ sprites */

export function buildSprites() {
  const parts = [];
  for (const sprite of SPRITES) {
    if (!exists(sprite)) {
      parts.push(`<!-- 未登记：${escapeHtml(sprite)} -->`);
      continue;
    }
    parts.push(readText(sprite).trim());
  }
  // A wrapper, because not every committed sprite carries its own
  // `display:none`; `<use>` still resolves symbols inside a hidden subtree.
  return `<div aria-hidden="true" style="display:none">\n${parts.join("\n")}\n</div>`;
}

/* ------------------------------------------------------------------- tokens */

/** Parse the `:root` custom properties of tokens.brutal.css, in file order. */
export function parseTokens(css = readText(TOKENS_CSS)) {
  const rootStart = css.indexOf(":root {");
  if (rootStart < 0) return [];
  let depth = 0;
  let end = rootStart;
  for (
    let index = css.indexOf("{", rootStart);
    index < css.length;
    index += 1
  ) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  const body = css.slice(css.indexOf("{", rootStart) + 1, end);
  const tokens = [];
  for (const line of body.split(/\n/u)) {
    const match =
      /^\s*(--[\w-]+)\s*:\s*([^;]+);\s*(?:\/\*\s*(.*?)\s*\*\/)?/u.exec(line);
    if (match === null) continue;
    tokens.push({
      name: match[1],
      value: match[2].trim(),
      note: (match[3] ?? "").trim(),
    });
  }
  return tokens;
}

const TOKEN_GROUPS = [
  {
    id: "space",
    title: "间距与控件刻度",
    match: (name) => /^--(space|control|icon)-/u.test(name),
  },
  {
    id: "type",
    title: "字号 / 字重 / 字距 / 字体",
    match: (name) =>
      /^--(text|fs|fw|tracking)-/u.test(name) ||
      name === "--sans" ||
      name === "--mono",
  },
  {
    id: "line",
    title: "描边与阴影",
    match: (name) => /^--(bd|bw|shadow|press|transition)/u.test(name),
  },
  {
    id: "layout",
    title: "桌面布局度量",
    match: (name) =>
      /^--(rail-w|sidebar-w|thread-w|head-h|tabs-h|message-line|composer-box-h)$/u.test(
        name,
      ),
  },
  {
    id: "semantic",
    title: "语义色",
    match: (name) => !/^--brutal-/u.test(name),
  },
  { id: "scale", title: "刻度层（组件不得直接消费）", match: () => true },
];

export function groupTokens(tokens) {
  const groups = TOKEN_GROUPS.map((group) => ({ ...group, tokens: [] }));
  for (const token of tokens) {
    const group = groups.find((candidate) => candidate.match(token.name));
    group.tokens.push(token);
  }
  return groups.filter((group) => group.tokens.length > 0);
}

/* -------------------------------------------------------------------- specs */

export function loadSpecs() {
  if (!exists(SPEC_DIRECTORY)) return [];
  return readdirSync(at(SPEC_DIRECTORY))
    .filter((name) => name.endsWith(".spec.json"))
    .sort()
    .map((name) => JSON.parse(readText(`${SPEC_DIRECTORY}/${name}`)));
}

export function loadRatchet() {
  return exists(RATCHET) ? JSON.parse(readText(RATCHET)) : null;
}

/* ---------------------------------------------------------- mini markdown */

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/gu, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
}

const isTableRow = (line) => /^\s*\|.*\|\s*$/u.test(line);
const isDivider = (line) => /^\s*\|[\s:|-]+\|\s*$/u.test(line);
const cells = (line) =>
  line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());

/** Render the markdown subset the spec docs and SKILL.md actually use. */
export function renderMarkdown(markdown) {
  const lines = String(markdown).split(/\r?\n/u);
  const out = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const block = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        block.push(lines[index]);
        index += 1;
      }
      index += 1;
      out.push(`<pre class="uic-code">${escapeHtml(block.join("\n"))}</pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line);
    if (heading !== null) {
      const level = Math.min(6, heading[1].length + 2);
      out.push(
        `<h${level} class="uic-md-head">${inline(heading[2])}</h${level}>`,
      );
      index += 1;
      continue;
    }
    if (isTableRow(line)) {
      const rows = [];
      while (index < lines.length && isTableRow(lines[index])) {
        if (!isDivider(lines[index])) rows.push(cells(lines[index]));
        index += 1;
      }
      const [head, ...body] = rows;
      out.push(
        `<div class="uic-scroll"><table class="uic-table"><thead><tr>${head
          .map((cell) => `<th>${inline(cell)}</th>`)
          .join("")}</tr></thead><tbody>${body
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    if (/^\s*(?:[-*]|\d+\.)\s+/u.test(line)) {
      const ordered = /^\s*\d+\./u.test(line);
      const items = [];
      while (
        index < lines.length &&
        /^\s*(?:[-*]|\d+\.)\s+/u.test(lines[index])
      ) {
        items.push(lines[index].replace(/^\s*(?:[-*]|\d+\.)\s+/u, ""));
        index += 1;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(
        `<${tag} class="uic-list">${items.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`,
      );
      continue;
    }
    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !lines[index].startsWith("```") &&
      !isTableRow(lines[index]) &&
      !/^#{1,6}\s/u.test(lines[index]) &&
      !/^\s*(?:[-*]|\d+\.)\s+/u.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }
  return out.join("\n");
}

/* --------------------------------------------------------------- skill steps */

export function parseSkillSteps(markdown) {
  const steps = [];
  const sections = String(markdown).split(/^### /mu).slice(1);
  for (const section of sections) {
    const newline = section.indexOf("\n");
    steps.push({
      title: section.slice(0, newline < 0 ? section.length : newline).trim(),
      body: newline < 0 ? "" : section.slice(newline + 1).trim(),
    });
  }
  return steps;
}

/* ---------------------------------------------------- checker constraints */

/** The six batch-2 constraints out of the checker's own header comment. */
export function parseCheckerConstraints(source) {
  const marker = source.indexOf("// Batch 2");
  if (marker < 0) return [];
  const header = source.slice(marker).split(/\nimport /u)[0];
  const constraints = [];
  for (const line of header.split(/\n/u)) {
    const start = /^\/\/\s{3}(\d)\.\s+(.*)$/u.exec(line);
    if (start !== null) {
      constraints.push({ index: Number(start[1]), text: start[2].trim() });
      continue;
    }
    const continuation = /^\/\/\s{6}(.*)$/u.exec(line);
    if (continuation !== null && constraints.length > 0) {
      constraints[constraints.length - 1].text += ` ${continuation[1].trim()}`;
    }
  }
  return constraints.filter((entry) => entry.index >= 1 && entry.index <= 6);
}

/* ------------------------------------------------------------- doc sections */

export function docSection(markdown, keyword) {
  const lines = String(markdown).split(/\r?\n/u);
  const start = lines.findIndex(
    (line) => /^##\s/u.test(line) && line.includes(keyword),
  );
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return {
    heading: lines[start].replace(/^##\s+/u, "").trim(),
    body: lines
      .slice(start + 1, end)
      .join("\n")
      .trim(),
  };
}

/* ----------------------------------------------------------------- previews */

const icon = (name, className = "") =>
  `<svg aria-hidden="true"${className ? ` class="${className}"` : ""}><use href="#raft-icon-${name}"></use></svg>`;

const SHELL_PAD = "calc(var(--space-2) * 3)";
const SIDEBAR_WIDTH = "calc(var(--control-8) * 10)";
const SIDEBAR_HEIGHT = "calc(var(--control-8) * 16)";

function variantCell(label, note, markup) {
  return `<figure class="uic-variant">
  <figcaption class="uic-variant-head"><span class="uic-variant-name">${escapeHtml(label)}</span>${
    note ? `<span class="uic-variant-note">${escapeHtml(note)}</span>` : ""
  }</figcaption>
  <div class="uic-stage"><div class="rah-product-shell" style="padding:${SHELL_PAD}">${markup}</div></div>
</figure>`;
}

const sqButton = (extra = "", attributes = "") =>
  `<button type="button" class="sq-btn${extra}" ${attributes}>${icon("plus")}</button>`;

const PREVIEWS = new Map([
  [
    "sq-btn",
    () => [
      variantCell("base", "", sqButton()),
      variantCell("hover", "真实 CSS：把鼠标放上去", sqButton()),
      variantCell("active", "真实 CSS：按住不放", sqButton()),
      variantCell("disabled", "真实 disabled 属性", sqButton("", "disabled")),
      variantCell("focus-visible", "仅键盘：Tab 到它", sqButton()),
      variantCell(
        "尺寸变体 .sm / 标准 / 关闭钮",
        "24 / 28 / 32",
        `<div style="display:flex;gap:var(--space-2);align-items:center">${sqButton(" sm")}${sqButton()}<div class="rah-agent-reset-dialog"><header>${sqButton()}</header></div></div>`,
      ),
      variantCell(
        "会话头部 .head-actions",
        "响应式分支只在 767.98px 以下生效",
        `<div class="rah-conversation-head" style="display:flex;width:max-content"><div class="head-actions">${sqButton()}</div></div>`,
      ),
      variantCell(
        "composer：拾取器与发送钮",
        "禁用态并排",
        `<div class="composer-bar"><div class="rah-composer-pickers"><button type="button" class="sq-btn rah-composer-picker">${icon("image-plus")}</button><button type="button" class="sq-btn rah-composer-picker" disabled>${icon("image-plus")}</button></div><button type="button" class="send-btn">${icon("send")}</button><button type="button" class="send-btn" disabled>${icon("send")}</button></div>`,
      ),
    ],
  ],
  [
    "sidebar-row",
    () => {
      const sectionHead = (label, disabled) => `<div class="side-title">
  <button type="button" class="rah-sidebar-disclosure" aria-expanded="true">${icon("chevron-down")}<span>${escapeHtml(label)}</span><span class="count">3</span></button>
  <div class="rah-sidebar-section-actions">
    <div class="rah-sidebar-sort"><button type="button" class="task-filter-trigger rah-interaction-flat" aria-label="${escapeHtml(label)}排序"${disabled ? " disabled" : ""}>${icon("arrow-up-down")}</button></div>
    <button type="button" aria-label="新建频道" class="rah-side-create rah-interaction-flat"${disabled ? " disabled" : ""}>${icon("plus")}</button>
  </div>
</div>`;
      const sidebar = `<div class="sidebar" style="width:${SIDEBAR_WIDTH};height:${SIDEBAR_HEIGHT}">
  <div class="sidebar-body">
    <button type="button" class="sidebar-bookmarks">${icon("bookmark")}<span>已保存</span></button>
    <section class="side-section">${sectionHead("频道", false)}
      <div>
        <a class="channel-row" href="#">${icon("hash", "row-icon")}<span class="rah-sidebar-channel-name">test</span></a>
        <a class="channel-row is-selected" href="#">${icon("hash", "row-icon")}<span class="rah-sidebar-channel-name">general</span></a>
      </div>
    </section>
    <section class="side-section">${sectionHead("私信", true)}
      <div>
        <a class="channel-row rah-direct-room-row" href="#"><span class="rah-direct-room-fallback">A</span><span class="rah-direct-row-identity"><b class="rah-direct-row-name">Agent Council</b><small>协调者</small></span></a>
      </div>
    </section>
  </div>
</div>`;
      return [
        variantCell(
          "base / selected / disabled 并排",
          "第二行是 .is-selected；私信分区的两个迷你钮是真实 disabled",
          sidebar,
        ),
        variantCell(
          "hover / active / focus-visible",
          "hover 与 active 是真实 CSS；focus-visible 需键盘 Tab",
          `<div class="sidebar" style="width:${SIDEBAR_WIDTH}"><div class="sidebar-body"><div><a class="channel-row" href="#">${icon("hash", "row-icon")}<span class="rah-sidebar-channel-name">hover-me</span></a><a class="channel-row" href="#">${icon("hash", "row-icon")}<span class="rah-sidebar-channel-name">press-me</span></a><a class="channel-row" href="#">${icon("hash", "row-icon")}<span class="rah-sidebar-channel-name">tab-to-me</span></a></div></div></div>`,
        ),
      ];
    },
  ],
]);

/* -------------------------------------------------------------- page chrome */

// The page chrome obeys the scale it documents: every length is a token or a
// calc() of tokens. Raw px appears exactly once, in the responsive breakpoint —
// 767.98px is the product's own `md:` boundary and tokens.brutal.css registers
// no breakpoint token.
export const CHROME_CSS = `
/* Chrome-only: never a blanket .uic-page descendant rule, which would beat
   .rah-product-shell's own min-width and change what the previews render. */
.uic-page, .uic-hero, .uic-nav, .uic-section, .uic-steps, .uic-step,
.uic-list, .uic-list li, .uic-missing, .uic-foot, .uic-foot li,
.uic-md-head, .uic-section p, .uic-component, .uic-component-body {
  min-width: 0;
  overflow-wrap: anywhere;
}
.uic-page {
  max-width: calc(var(--control-8) * 40);
  margin: 0 auto;
  padding: var(--space-3);
  background: var(--cream);
  color: var(--ink);
  font-family: var(--sans);
}
.uic-hero {
  border: var(--bd);
  box-shadow: var(--shadow-l);
  background: var(--yellow);
  padding: calc(var(--space-3) * 2);
  margin-bottom: var(--space-3);
}
.uic-hero h1 {
  font-size: var(--text-2xl);
  font-weight: var(--fw-bold);
  letter-spacing: var(--tracking-widest);
  text-transform: uppercase;
}
.uic-hero p { margin-top: var(--space-2); font-size: var(--fs-body); max-width: calc(var(--control-8) * 22); }
.uic-hero dl {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
  font-family: var(--mono);
  font-size: var(--fs-meta);
}
.uic-hero dl > div {
  border: var(--bd);
  background: var(--paper);
  box-shadow: var(--shadow-s);
  padding: var(--space-1) var(--space-2);
}
.uic-hero dt { font-weight: var(--fw-bold); text-transform: uppercase; }
.uic-nav { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-3); }
.uic-nav a {
  border: var(--bd);
  background: var(--paper);
  box-shadow: var(--shadow-s);
  padding: var(--space-1) var(--space-2);
  font-family: var(--mono);
  font-size: var(--fs-meta);
  font-weight: var(--fw-bold);
  color: var(--ink);
  text-decoration: none;
}
.uic-nav a:hover { background: var(--pink); box-shadow: var(--shadow-m); }
.uic-section {
  border: var(--bd);
  background: var(--paper);
  box-shadow: var(--shadow-m);
  padding: var(--space-3);
  margin-bottom: var(--space-3);
}
.uic-section > h2 {
  font-size: var(--text-xl);
  font-weight: var(--fw-bold);
  border-bottom: var(--bd);
  padding-bottom: var(--space-2);
  margin-bottom: var(--space-3);
}
.uic-section > h3, .uic-section h3 {
  font-size: var(--text-lg);
  font-weight: var(--fw-bold);
  margin-top: var(--space-3);
  margin-bottom: var(--space-2);
}
.uic-md-head { font-size: var(--fs-channel-title); font-weight: var(--fw-bold); margin: var(--space-2) 0; }
.uic-section p { font-size: var(--fs-body); margin-bottom: var(--space-2); }
.uic-list { margin: 0 0 var(--space-2) var(--space-3); font-size: var(--fs-body); }
.uic-list li { margin-bottom: var(--space-1); }
.uic-code, .uic-section code {
  font-family: var(--mono);
  font-size: var(--fs-meta);
  background: var(--cream);
  border: var(--bd);
  padding: var(--space-1) var(--space-2);
}
.uic-code { display: block; overflow-x: auto; white-space: pre; margin-bottom: var(--space-2); }
.uic-section code { padding: 0 var(--space-1); border-width: 0; background: var(--hover-yellow); }
.uic-steps { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); }
.uic-step { border: var(--bd); box-shadow: var(--shadow-s); padding: var(--space-2); background: var(--cream); }
.uic-step > h3 { margin-top: 0; font-size: var(--fs-channel-title); }
.uic-scroll { overflow-x: auto; max-width: 100%; border: var(--bd); margin-bottom: var(--space-2); }
.uic-scroll-tall { max-height: calc(var(--control-8) * 14); overflow-y: auto; }
.uic-table { border-collapse: collapse; width: 100%; font-size: var(--fs-meta); font-family: var(--mono); }
.uic-table th, .uic-table td {
  border-bottom: var(--bd);
  border-right: var(--bd);
  padding: var(--space-1) var(--space-2);
  text-align: left;
  vertical-align: top;
}
.uic-table thead th { background: var(--yellow); font-weight: var(--fw-bold); position: sticky; top: 0; }
.uic-table tbody tr:hover { background: var(--hover-yellow); }
.uic-component { border: var(--bd); box-shadow: var(--shadow-m); margin-bottom: var(--space-3); background: var(--paper); }
.uic-component > header {
  border-bottom: var(--bd);
  background: var(--pink);
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: baseline;
}
.uic-component > header h3 { margin: 0; font-size: var(--text-lg); font-weight: var(--fw-bold); }
.uic-component > header .uic-prov { font-family: var(--mono); font-size: var(--fs-meta); }
.uic-component-body { padding: var(--space-3); }
.uic-variants { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-3); }
.uic-variant { border: var(--bd); background: var(--cream); box-shadow: var(--shadow-s); }
.uic-variant-head {
  border-bottom: var(--bd);
  background: var(--paper);
  padding: var(--space-1) var(--space-2);
  font-family: var(--mono);
  font-size: var(--fs-micro);
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
}
.uic-variant-name { font-weight: var(--fw-bold); text-transform: uppercase; }
.uic-variant-note { color: var(--muted); }
.uic-stage { overflow: auto; max-width: calc(var(--control-8) * 16); }
.uic-badge {
  display: inline-block;
  border: var(--bd);
  padding: 0 var(--space-1);
  font-family: var(--mono);
  font-size: var(--fs-micro);
  font-weight: var(--fw-bold);
  background: var(--gray-chip);
}
.uic-badge-amber { background: var(--orange); }
.uic-badge-ok { background: var(--green); }
.uic-missing {
  border: var(--bd);
  background: var(--gray-chip);
  padding: var(--space-2);
  font-family: var(--mono);
  font-size: var(--fs-meta);
  margin-bottom: var(--space-2);
}
.uic-swatch { display: inline-block; width: var(--control-6); height: var(--control-6); border: var(--bd); vertical-align: middle; }
.uic-ruler { display: inline-block; height: var(--space-2); background: var(--ink); vertical-align: middle; }
.uic-foot {
  border: var(--bd);
  box-shadow: var(--shadow-s);
  background: var(--cream);
  padding: var(--space-3);
  font-family: var(--mono);
  font-size: var(--fs-meta);
}
.uic-foot ul { margin: var(--space-2) 0 0 var(--space-3); }
@media (max-width: 767.98px) {
  .uic-page { padding: var(--space-2); }
  .uic-hero { padding: var(--space-3); }
  .uic-variants { display: block; }
  .uic-variant { margin-bottom: var(--space-2); }
  .uic-stage { max-width: 100%; }
  .uic-nav { display: block; }
  .uic-nav a { display: block; margin-bottom: var(--space-1); }
}
`;

/* --------------------------------------------------------------- rendering */

const missing = (what) =>
  `<div class="uic-missing">未登记：${escapeHtml(what)}</div>`;

function renderDeclarations(declarations) {
  return Object.entries(declarations ?? {})
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
}

function renderRules(spec) {
  if (!Array.isArray(spec.rules) || spec.rules.length === 0) {
    return missing(`${spec.component} 的 rules`);
  }
  const rows = spec.rules
    .map(
      (rule) => `<tr>
  <td>${escapeHtml(rule.selector)}</td>
  <td>${escapeHtml(rule.state ?? "base")}</td>
  <td class="uic-expect">${escapeHtml(renderDeclarations(rule.declarations))}</td>
  <td>${escapeHtml(rule.file ?? "")}</td>
  <td>${escapeHtml(rule.source ?? "")}</td>
</tr>`,
    )
    .join("\n");
  return `<div class="uic-scroll uic-scroll-tall"><table class="uic-table"><thead><tr><th>选择器</th><th>状态</th><th>上游期望（字面量）</th><th>文件</th><th>上游来源</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderOverrides(spec) {
  if (!Array.isArray(spec.overrides) || spec.overrides.length === 0) {
    return `<p>无登记例外。</p>`;
  }
  const rows = spec.overrides
    .map((override) => {
      const unresolved = override.status === "registered-unresolved";
      return `<tr>
  <td>${escapeHtml(override.selector)}</td>
  <td>${escapeHtml(override.state ?? "base")}</td>
  <td><span class="uic-badge${unresolved ? " uic-badge-amber" : ""}">${escapeHtml(override.status ?? "registered")}</span></td>
  <td>${escapeHtml(renderDeclarations(override.declarations))}</td>
  <td>${escapeHtml(override.source ?? "")}</td>
  <td>${escapeHtml(override.reason ?? "")}</td>
  <td>${escapeHtml(override.since ?? "")}</td>
  <td>${escapeHtml(override.evidenceNeeded ?? "")}</td>
</tr>`;
    })
    .join("\n");
  return `<div class="uic-scroll uic-scroll-tall"><table class="uic-table"><thead><tr><th>选择器</th><th>状态</th><th>登记</th><th>声明</th><th>source</th><th>reason</th><th>since</th><th>evidenceNeeded</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderPending(spec) {
  if (!Array.isArray(spec.pending) || spec.pending.length === 0) {
    return `<p>无挂起问题。</p>`;
  }
  const rows = spec.pending
    .map(
      (entry) => `<tr>
  <td>${escapeHtml(entry.id)}</td>
  <td>${escapeHtml(entry.question ?? "")}</td>
  <td>${escapeHtml(entry.evidenceNeeded ?? "")}</td>
  <td>${escapeHtml(entry.since ?? "")}</td>
</tr>`,
    )
    .join("\n");
  return `<div class="uic-scroll uic-scroll-tall"><table class="uic-table"><thead><tr><th>id</th><th>问题</th><th>需要的证据</th><th>since</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderBrowserExpectations(spec) {
  const expectations = spec.browserExpectations;
  if (expectations === undefined || Object.keys(expectations).length === 0) {
    return missing(`${spec.component} 的 browserExpectations`);
  }
  const rows = Object.entries(expectations)
    .map(
      ([key, value]) =>
        `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`,
    )
    .join("\n");
  return `<div class="uic-scroll uic-scroll-tall"><table class="uic-table"><thead><tr><th>视口 / probe / 属性</th><th>期望计算值</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderRatchet(component, ratchet) {
  const entry = ratchet?.[component];
  if (entry === undefined) return missing(`ratchet.json 中的 ${component}`);
  return `<div class="uic-scroll"><table class="uic-table"><thead><tr><th>overrides</th><th>overrideBudget</th><th>pending</th></tr></thead><tbody><tr><td>${entry.overrides}</td><td>${entry.overrideBudget}</td><td>${entry.pending}</td></tr></tbody></table></div>`;
}

function renderPreview(spec) {
  const factory = PREVIEWS.get(spec.component);
  if (factory === undefined) {
    return missing(
      `${spec.component} 的静态预览（scripts/build-ui-catalog.mjs 尚未收录其 fixture 结构）`,
    );
  }
  return `<div class="uic-variants">${factory().join("\n")}</div>`;
}

/** Split the inlined CSS into `@media` blocks (condition + body). */
export function mediaBlocks(css) {
  const blocks = [];
  const pattern = /@media([^{]+)\{/gu;
  let match;
  while ((match = pattern.exec(css)) !== null) {
    let depth = 1;
    let index = pattern.lastIndex;
    while (index < css.length && depth > 0) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push({
      condition: match[1].trim().replace(/\s+/gu, " "),
      body: css.slice(pattern.lastIndex, index - 1),
    });
    pattern.lastIndex = index;
  }
  return blocks;
}

/**
 * Class tokens this component owns: `classNames` only. Harvesting the class
 * names out of `rules[].selector` would drag in every ancestor the selectors
 * mention (`.rah-product-shell`, `.composer-bar`) and turn the responsive note
 * into a list of the whole product's media queries.
 */
function componentClasses(spec) {
  return [...new Set(spec.classNames ?? [])];
}

/** Responsive note: the real `@media` rules in the product CSS that touch it. */
function renderResponsive(spec, blocks) {
  const classes = componentClasses(spec);
  const rows = [];
  for (const block of blocks) {
    const selectors = new Set();
    for (const match of block.body.matchAll(/(^|\})\s*([^{}@]+)\{/gu)) {
      const selector = match[2].trim().replace(/\s+/gu, " ");
      if (selector === "" || selector.startsWith("/*")) continue;
      if (classes.some((className) => selector.includes(className))) {
        selectors.add(selector);
      }
    }
    for (const selector of selectors) {
      rows.push({ condition: block.condition, selector });
    }
  }
  if (rows.length === 0) {
    return missing(
      `${spec.component} 的响应式分支（产品 CSS 里没有触及该组件的 @media 规则）`,
    );
  }
  return `<div class="uic-scroll uic-scroll-tall"><table class="uic-table"><thead><tr><th>条件</th><th>选择器</th></tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.condition)}</td><td>${escapeHtml(row.selector)}</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function renderDoc(spec) {
  const docPath = spec.doc ?? `${SPEC_DOCS}/${spec.component}.zh-CN.md`;
  if (!exists(docPath)) return missing(`规格文档 ${docPath}`);
  const markdown = readText(docPath);
  const scope = docSection(markdown, "改动边界");
  const pending = docSection(markdown, "挂起");
  const parts = [
    `<p>规格文档：<code>${escapeHtml(docPath)}</code></p>`,
    scope === null
      ? missing(`${docPath} 的「改动边界」小节`)
      : `<h4 class="uic-md-head">${escapeHtml(scope.heading)}</h4>${renderMarkdown(scope.body)}`,
    pending === null
      ? missing(`${docPath} 的「挂起」小节`)
      : `<h4 class="uic-md-head">${escapeHtml(pending.heading)}</h4>${renderMarkdown(pending.body)}`,
  ];
  return parts.join("\n");
}

function renderComponent(spec, ratchet, mediaBlockList) {
  const provenance = spec.provenance ?? {};
  return `<article class="uic-component" id="component-${escapeHtml(spec.component)}">
  <header>
    <h3>${escapeHtml(spec.component)}</h3>
    <span class="uic-prov">${escapeHtml((spec.classNames ?? []).join(" "))}</span>
    <span class="uic-prov">${escapeHtml(provenance.release ?? "未登记 release")} · ${escapeHtml((provenance.commit ?? "").slice(0, 12))} · ${escapeHtml(provenance.builtAt ?? "")}</span>
  </header>
  <div class="uic-component-body">
    <h4 class="uic-md-head">预览（真实产品 CSS）</h4>
    ${renderPreview(spec)}
    <h4 class="uic-md-head">响应式分支（产品 CSS 中触及本组件的 @media）</h4>
    ${renderResponsive(spec, mediaBlockList)}
    <h4 class="uic-md-head">上游来源</h4>
    <div class="uic-scroll"><table class="uic-table"><tbody>
      <tr><th>上游选择器</th><td>${escapeHtml(provenance.selector ?? "未登记")}</td></tr>
      <tr><th>证据 CSS</th><td>${escapeHtml(provenance.cssFile ?? "未登记")}<br>${escapeHtml(provenance.cssSha256 ?? "")}</td></tr>
      <tr><th>证据 JS</th><td>${escapeHtml(provenance.jsFile ?? "未登记")}<br>${escapeHtml(provenance.jsSha256 ?? "")}</td></tr>
      <tr><th>覆盖率报告</th><td>${escapeHtml(spec.matchedRulesFile ?? "未登记")}</td></tr>
    </tbody></table></div>
    <h4 class="uic-md-head">登记规则</h4>
    ${renderRules(spec)}
    <h4 class="uic-md-head">令牌契约</h4>
    ${
      Array.isArray(spec.tokenContract) && spec.tokenContract.length > 0
        ? `<div class="uic-scroll uic-scroll-tall"><table class="uic-table"><thead><tr><th>令牌</th><th>上游推导</th><th>来源</th></tr></thead><tbody>${spec.tokenContract
            .map(
              (entry) =>
                `<tr><td>${escapeHtml(entry.token)}</td><td>${escapeHtml(JSON.stringify(entry.derivation))}</td><td>${escapeHtml(entry.source ?? "")}</td></tr>`,
            )
            .join("")}</tbody></table></div>`
        : missing(`${spec.component} 的 tokenContract`)
    }
    <h4 class="uic-md-head">例外（白名单只减不增）</h4>
    ${renderOverrides(spec)}
    <h4 class="uic-md-head">挂起</h4>
    ${renderPending(spec)}
    <h4 class="uic-md-head">Ratchet</h4>
    ${renderRatchet(spec.component, ratchet)}
    <h4 class="uic-md-head">浏览器门禁期望</h4>
    ${renderBrowserExpectations(spec)}
    <h4 class="uic-md-head">规格文档</h4>
    ${renderDoc(spec)}
  </div>
</article>`;
}

const BATCH_RULES = [
  "一次只处理一个共享组件；一个批次一个组件。",
  "动手前先登记上游：element、source（文件行）、version（release + commit）、values、states。",
  "先做同值 token 替换，并用门禁 --compare 证明计算值一字未变，然后才谈改值。",
  "只改「同条件双边实测有差异」的项；没有同条件证据的差异一律挂起。",
  "禁止顺手取整：不把 7 改成 8，不把 15 改成 14。",
  "白名单只减不增：新增 override 必须带 source + reason + pending，预算只能通过已提交的 ratchet 下降。",
  "保留用户指定的设计：紧凑的 Runtime 行、单行描述、对齐的勾选框、灰色的不支持态；不另开 Runtime 页面。",
  "每批次汇报：改了什么 + 依据、实际跑过的检查、仍存在的差异。",
];

const COMMANDS = [
  "npm run check:ui-library",
  "node scripts/ui-component-spec.mjs [--allow-uncommitted-ratchet]",
  "node scripts/run-<component>-spec-browser-gate.mjs --write-baseline <path>",
  "node scripts/run-<component>-spec-browser-gate.mjs --compare <path>",
  "node scripts/run-<component>-spec-browser-gate.mjs --expect-spec",
  "node scripts/run-<component>-spec-browser-gate.mjs --report-matching-rules",
  "node --test scripts/ui-component-spec.test.mjs",
];

function renderTokenTable(groups) {
  return groups
    .map((group) => {
      const rows = group.tokens
        .map((token) => {
          const isColor = /^(#|oklch|rgba?\()/u.test(token.value);
          const lengthMatch = /^(\d+)px$/u.exec(token.value);
          let sample = "";
          if (isColor) {
            sample = `<span class="uic-swatch" style="background:${escapeHtml(token.value)}"></span>`;
          } else if (lengthMatch !== null) {
            sample = `<span class="uic-ruler" style="width:var(${escapeHtml(token.name)})"></span>`;
          }
          return `<tr><td>${escapeHtml(token.name)}</td><td>${escapeHtml(token.value)}</td><td>${sample}</td><td>${escapeHtml(token.note)}</td></tr>`;
        })
        .join("");
      return `<h3>${escapeHtml(group.title)}（${group.tokens.length}）</h3>
<div class="uic-scroll uic-scroll-tall"><table class="uic-table"><thead><tr><th>令牌</th><th>值</th><th>样例</th><th>登记说明</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    })
    .join("\n");
}

export function buildCatalog() {
  const { css, order, files, fontBytes } = buildProductCss();
  const mediaBlockList = mediaBlocks(css);
  const sprites = buildSprites();
  const specs = loadSpecs();
  const ratchet = loadRatchet();
  const tokens = parseTokens();
  const groups = groupTokens(tokens);
  const skillSteps = exists(SKILL) ? parseSkillSteps(readText(SKILL)) : [];
  const constraints = exists(CHECKER)
    ? parseCheckerConstraints(readText(CHECKER))
    : [];
  const specComponents = new Set(specs.map((spec) => spec.component));
  const orphanDocs = exists(SPEC_DOCS)
    ? readdirSync(at(SPEC_DOCS))
        .filter((name) => name.endsWith(".zh-CN.md"))
        .map((name) => name.replace(/\.zh-CN\.md$/u, ""))
        .filter((name) => !specComponents.has(name))
        .sort()
    : [];

  const head = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>RAH OS 新粗野 UI 目录</title>
<style id="uic-product">${css}</style>
<style id="uic-chrome">${CHROME_CSS}</style>`;

  const hero = `<header class="uic-hero" id="hero">
  <h1>RAH OS 新粗野 UI 目录</h1>
  <p>本页只用产品自身的样式表渲染，页面外壳与它所记录的刻度同源。所有数值来自已提交的规格与令牌文件，没有一处是手抄的。</p>
  <dl>
    <div><dt>组件规格</dt><dd>${specs.length}</dd></div>
    <div><dt>令牌</dt><dd>${tokens.length}</dd></div>
    <div><dt>内联样式表</dt><dd>${files.length}</dd></div>
    <div><dt>生成器</dt><dd>scripts/build-ui-catalog.mjs</dd></div>
  </dl>
</header>`;

  const nav = `<nav class="uic-nav">
  <a href="#how">怎么用</a>
  <a href="#rules">规则与约束</a>
  ${specs.map((spec) => `<a href="#component-${escapeHtml(spec.component)}">${escapeHtml(spec.component)}</a>`).join("\n  ")}
  <a href="#tokens">令牌刻度</a>
</nav>`;

  const how = `<section class="uic-section" id="how">
  <h2>怎么用：ui-component-spec 技能</h2>
  <p>技能文件：<code>${escapeHtml(SKILL)}</code>。任何 RAH OS 的尺寸 / 样式改动、任何新组件对齐 Raft，都走这条流程。</p>
  ${
    skillSteps.length === 0
      ? missing(`${SKILL} 的步骤`)
      : `<div class="uic-steps">${skillSteps
          .map(
            (step) =>
              `<div class="uic-step"><h3>${escapeHtml(step.title)}</h3>${renderMarkdown(step.body)}</div>`,
          )
          .join("\n")}</div>`
  }
</section>`;

  const rules = `<section class="uic-section" id="rules">
  <h2>规则与约束</h2>
  <h3>批次规则（人给的）</h3>
  <ol class="uic-list">${BATCH_RULES.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ol>
  <h3>校验器的六条机械约束</h3>
  <p>逐字取自 <code>${escapeHtml(CHECKER)}</code> 的头部注释。</p>
  ${
    constraints.length === 0
      ? missing(`${CHECKER} 的约束列表`)
      : `<ol class="uic-list">${constraints
          .map((entry) => `<li>${escapeHtml(entry.text)}</li>`)
          .join("")}</ol>`
  }
  <h3>命令</h3>
  <pre class="uic-code">${escapeHtml(COMMANDS.join("\n"))}</pre>
</section>`;

  const components = `<section class="uic-section" id="components">
  <h2>组件预览与规格</h2>
  <p>预览是真实产品标记，包在 <code>.rah-product-shell</code> 里：hover 与 active 是真的 CSS，disabled 是真的 <code>disabled</code> 属性，focus-visible 只在键盘 Tab 时出现。<code>.rah-product-shell</code> 的 <code>min-width</code> 比预览格宽，所以每个舞台自带横向滚动。</p>
  ${specs.length === 0 ? missing(`${SPEC_DIRECTORY}/*.spec.json`) : specs.map((spec) => renderComponent(spec, ratchet, mediaBlockList)).join("\n")}
  ${
    orphanDocs.length === 0
      ? ""
      : `<h3>只有文档、尚无规格 JSON</h3>${missing(`${orphanDocs.map((name) => `${SPEC_DOCS}/${name}.zh-CN.md`).join("、")} 没有对应的 *.spec.json，无法在本页登记其规则、例外与门禁期望`)}`
  }
</section>`;

  const tokenSection = `<section class="uic-section" id="tokens">
  <h2>令牌刻度</h2>
  <p>来源：<code>${escapeHtml(TOKENS_CSS)}</code> 的 <code>:root</code>。组件只允许消费语义层；刻度层只做语义层的取值来源。</p>
  ${tokens.length === 0 ? missing(`${TOKENS_CSS} 的 :root`) : renderTokenTable(groups)}
</section>`;

  const fontTotal = [...fontBytes.values()].reduce(
    (sum, size) => sum + size,
    0,
  );
  const footer = `<footer class="uic-foot">
  <p>本页由 <code>node scripts/build-ui-catalog.mjs</code> 生成，请勿手改 <code>${escapeHtml(OUTPUT)}</code>。</p>
  <ul>
    <li>样式表载入顺序（取自 <code>${escapeHtml(PRODUCT_STYLES)}</code>）：${escapeHtml(order.join(" → "))}</li>
    <li>内联字体：${[...fontBytes.keys()].map((name) => escapeHtml(name)).join("、")}（合计 ${fontTotal} 字节，base64 后约 ${Math.round((fontTotal * 4) / 3)} 字节）</li>
    <li>图标雪碧图：${SPRITES.map((sprite) => escapeHtml(sprite)).join("、")}</li>
    <li>规格来源：${escapeHtml(SPEC_DIRECTORY)}/*.spec.json、${escapeHtml(RATCHET)}、${escapeHtml(SPEC_DOCS)}/*.zh-CN.md</li>
    <li>本页为浅色单主题，与产品一致。</li>
  </ul>
</footer>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
${head}
</head>
<body style="background:var(--cream);color:var(--ink)">
${sprites}
<div class="uic-page">
${hero}
${nav}
${how}
${rules}
${components}
${tokenSection}
${footer}
</div>
</body>
</html>
`;
}

function main(argv) {
  const outIndex = argv.indexOf("--out");
  const out = outIndex >= 0 ? argv[outIndex + 1] : OUTPUT;
  const html = buildCatalog();
  if (argv.includes("--check")) {
    const current = exists(out) ? readText(out) : "";
    if (current !== html) {
      process.stderr.write(
        `${out} is stale; run node scripts/build-ui-catalog.mjs\n`,
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${out} is up to date\n`);
    return;
  }
  writeFileSync(at(out), html);
  process.stdout.write(`wrote ${out} (${Buffer.byteLength(html)} bytes)\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === `file://${resolve(process.argv[1])}`
) {
  main(process.argv.slice(2));
}

export { OUTPUT, SPEC_DIRECTORY, SPEC_DOCS, SKILL, CHECKER, TOKENS_CSS, join };
