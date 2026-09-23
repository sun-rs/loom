import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const packageRoot = join(import.meta.dirname, "..");
const repositoryRoot = join(packageRoot, "..", "..");

const verifiedArchiveRestoreAddition = `  <!-- Raft release/v1.16.0 index-CKeqacxz.js IKe/l5; Lucide archive-restore, ISC /legal/lucide-icons-LICENSE.txt. -->
  <symbol id="raft-icon-archive-restore" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h2"/><path d="M20 8v11a2 2 0 0 1-2 2h-2"/><path d="m9 15 3-3 3 3"/><path d="M12 12v9"/>
  </symbol>
`;

const verifiedListChecksAddition = `  <!-- Raft index-CRDaMXft.js sGe/iGe, SHA256 9247f38f78bfb5df423d4424882da63d18268324a9c9c151b52a49d772764271. Verbatim Lucide list-checks; ISC /legal/lucide-icons-LICENSE.txt. -->
  <symbol id="raft-icon-list-checks" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/></symbol>
`;

const verifiedCircleCheckBigAddition = `  <!-- Raft index-WTraJnrd.js qy/$Fe, verbatim Lucide circle-check-big; ISC /legal/lucide-icons-LICENSE.txt. -->
  <symbol id="raft-icon-circle-check-big" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>
  </symbol>
`;

// Raft index-MqTUR4Ez.js I6e/Ec, SHA256
// 9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443.
const verifiedCommentToggleAddition = `  <!-- Raft index-MqTUR4Ez.js lVe/Hse, SHA256 9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443. Verbatim Lucide message-square-more geometry. ISC: /legal/lucide-icons-LICENSE.txt; Copyright (c) 2026 Lucide Icons and Contributors. -->
  <symbol id="raft-icon-message-square-more" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>
    <path d="M12 11h.01"/><path d="M16 11h.01"/><path d="M8 11h.01"/>
  </symbol>
`;

const verifiedFileTextAddition = `  <!-- Raft index-MqTUR4Ez.js x6e/jy, SHA256 9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443. Verbatim Lucide file-text geometry. ISC: /legal/lucide-icons-LICENSE.txt; Copyright (c) 2026 Lucide Icons and Contributors. -->
  <symbol id="raft-icon-file-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/>
    <path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>
  </symbol>
`;

const verifiedThreadIconsAddition = `  <!-- Raft index-MqTUR4Ez.js g6e/Ose and b6e/Gv, SHA256 9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443; Lucide ISC geometry. -->
  <symbol id="raft-icon-ellipsis-vertical" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></symbol>
  <symbol id="raft-icon-external-link" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></symbol>
`;

const verifiedGitBranchAddition = `  <!-- Raft index-MqTUR4Ez.js I6e/Ec, SHA256 9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443:
       verbatim Lucide git-branch geometry; member graph header, section and sidebar. -->
  <symbol id="raft-icon-git-branch" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 6a9 9 0 0 0-9 9V3"/>
    <circle cx="18" cy="6" r="3"/>
    <circle cx="6" cy="18" r="3"/>
  </symbol>
`;

// Source-backed additions: 2026-09-18-agent-profile-field-ui,
// 2026-09-18-settings-activity-repair, 2026-09-19-deleted-agent-message-ui.
// Preserve the original base hash; pin the complete additions independently.
const verifiedProfileAndUnavailableIconsAddition = `  <!-- Raft v1.16.0 index-CKeqacxz.js E7e/AI, Lucide upload; ISC /legal/lucide-icons-LICENSE.txt. -->
  <symbol id="raft-icon-upload" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></symbol>
  <!-- Raft v1.16.0 AgentDetailPanel-CW_VMZT6.js Hl/Ia, Lucide clipboard; ISC /legal/lucide-icons-LICENSE.txt. -->
  <symbol id="raft-icon-clipboard" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></symbol>
  <!-- Raft v1.16.0 index-CKeqacxz.js T7e/Ul, Lucide triangle-alert; ISC /legal/lucide-icons-LICENSE.txt. -->
  <symbol id="raft-icon-triangle-alert" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></symbol>
`;

test("interaction icon geometry is frozen from Raft RFe/TFe/yze/cze/Bw, Agent tabs, profile, and Reminder live DOM", () => {
  const content = readFileSync(
    join(packageRoot, "src", "interaction-icons.svg"),
  );
  const source = content.toString("utf8");
  assert.ok(source.includes(verifiedProfileAndUnavailableIconsAddition));
  assert.ok(source.includes(verifiedArchiveRestoreAddition));
  assert.ok(source.includes(verifiedCircleCheckBigAddition));
  assert.ok(source.includes(verifiedListChecksAddition));
  for (const exactRaftPath of [
    'd="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"',
    'd="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"',
    'd="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0',
    'd="M16 12h2"',
    'd="M12 6v6h4"',
    'd="m17 2 4 4-4 4"',
    'd="M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742"',
    'd="m12 19-7-7 7-7"',
    'd="M19 12H5"',
    'd="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"',
  ]) {
    assert.match(
      source,
      new RegExp(exactRaftPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
    );
  }
  assert.doesNotMatch(
    source,
    /raft-icon-shield-check[^<]*>[\s\S]*?m9 12 2 2 4-4/u,
  );
  assert.equal(
    // Keep the entire prior sprite byte-frozen while adopting verified
    // arrow-left, image-plus and separately source-checked 2026-09-08 symbols.
    // Never promote a new whole-file hash to hide drift.
    createHash("sha256")
      .update(
        source
          .replace(verifiedProfileAndUnavailableIconsAddition, "")
          .replace(verifiedArchiveRestoreAddition, "")
          .replace(verifiedListChecksAddition, "")
          .replace(verifiedCircleCheckBigAddition, "")
          .replace(verifiedCommentToggleAddition, "")
          .replace(verifiedFileTextAddition, "")
          .replace(verifiedGitBranchAddition, "")
          .replace(verifiedThreadIconsAddition, "")
          .replace(
            /<symbol id="raft-icon-(?:archive|log-out|circle-stop)"[^\n]*\n/gu,
            "",
          )
          .replace(
            /  <!-- Raft index-BVfbaScj\.js vHe\/yHe: verbatim Lucide star geometry\. -->\n  <symbol id="raft-icon-star"[^\n]*\n/u,
            "",
          )
          .replace(
            /  <!-- Raft (?:AgentDetailPanel-DKwoNvgK\.js (?:Cl|Rl)|index-BoAC7nSE\.js (?:dBe|N3e)); verbatim geometry, local symbol wrapper\. -->\n  <symbol id="raft-icon-(?:folder-closed|menu|share-2|link)"(?:(?!<\/symbol>)[\s\S])*<\/symbol>\n/gu,
            "",
          )
          .replace(
            /<symbol id="raft-icon-play"(?:(?!<\/symbol>)[\s\S])*<\/symbol>\n/u,
            "",
          )
          .replace(
            /  <!-- Raft release\/v1\.12\.0 AgentDetailPanel-DSYPOiPi ql\/Wl: verbatim globe geometry\. -->\n  <symbol id="raft-icon-globe"(?:(?!<\/symbol>)[\s\S])*<\/symbol>\n/u,
            "",
          )
          .replace(
            /  <!-- Raft index-BVfbaScj\.js v\$e\/y\$e,[\s\S]*?<symbol id="raft-icon-image-plus"[\s\S]*?<\/symbol>\n/u,
            "",
          )
          .replace(
            /  <!-- Verbatim Lucide geometry from authorized Raft index-BVfbaScj\.js: O\$e, U\$e, z\$e\. -->\n(?:  <symbol id="raft-icon-(?:map-pin|message-circle-plus|message-circle-off)"[^\n]*\n){3}/u,
            "",
          )
          .replace(
            /  <!-- Raft live channel\/settings\/computer mobile back, index-Biin3FEA\.js,[\s\S]*?<symbol id="raft-icon-arrow-left"[\s\S]*?<\/symbol>\n/u,
            "",
          ),
      )
      .digest("hex"),
    "f1a811d309f01a77444817cfdecd07466e69bd9bb4999ac438efe9ea6029805d",
  );
});
test("context-menu icons retain source-checked Raft geometry", () => {
  const sprite = readFileSync(
    join(packageRoot, "src", "interaction-icons.svg"),
    "utf8",
  );
  // Raft index-BoAC7nSE.js: archive, log-out and circle-stop.
  const bodies = {
    archive:
      '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    "log-out":
      '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
    "circle-stop":
      '<circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  };
  for (const [name, body] of Object.entries(bodies)) {
    const symbol = `<symbol id="raft-icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`;
    assert.ok(sprite.includes(symbol), name);
  }
});

test("quick-reaction sprite is the unchanged official published asset", () => {
  const content = readFileSync(
    join(repositoryRoot, "apps/web/src/raft-reaction-sprite.svg"),
  );
  assert.equal(
    createHash("sha256").update(content).digest("hex"),
    "10912fdacbbfc427fcd1cdd0bc8ad7a2fc0a40fa121ee663f0a8ad19c67499f8",
  );
});

test("additional discovery icons retain the paths extracted from the Raft published bundle", () => {
  const content = readFileSync(join(packageRoot, "src", "discovery-icons.svg"));
  assert.equal(
    createHash("sha256").update(content).digest("hex"),
    "c53661c37138cd8c07b6648a7ec7f80c6a9c0953e0f609917be0ba17ed90aeec",
  );
});

test("adopted assets retain origin evidence without requiring mutable CSS to stay frozen", () => {
  const adoption = JSON.parse(
    readFileSync(join(packageRoot, "adoption.json"), "utf8"),
  );
  const snapshot = JSON.parse(
    readFileSync(join(repositoryRoot, adoption.originManifest), "utf8"),
  );
  assert.equal(adoption.files.length, 18);
  assert.deepEqual(adoption.source, snapshot.source);
  for (const entry of adoption.files) {
    assert.doesNotMatch(entry.path, /\.(?:html|js)$/);
    assert.equal(
      entry.originSha256,
      snapshot.files.find(
        (source: { path: string }) => source.path === entry.originPath,
      )?.sha256,
    );
    if (entry.policy === "immutable-asset") {
      assert.equal(
        createHash("sha256")
          .update(readFileSync(join(repositoryRoot, entry.path)))
          .digest("hex"),
        entry.originSha256,
      );
    }
  }
});

test("official Raft font mirrors are byte-exact and expose the message reaction metrics", () => {
  for (const [relativePath, expectedSha256] of [
    [
      "vendor/raft/official-fonts.css",
      "01e31b4f1fb7f6623acbd928a2ae50e29011b26121e6ea39fdc0241f7ac50ad7",
    ],
    [
      "vendor/raft/fonts/space-grotesk-latin.woff2",
      "a0d054c4af557de20afd6ca59f47ab353bcaec49c63ff04b6c9d39d0f8910557",
    ],
    [
      "vendor/raft/fonts/space-mono-400-latin.woff2",
      "e0c8e616bda27642f4c3cebaecff6525d901e73afc8a227cbbb0f2af4810f300",
    ],
    [
      "vendor/raft/fonts/space-mono-700-latin.woff2",
      "af7cf6d2b897ec453acdcdacde4e9bcc8410718af5914de865b453e09f10eebc",
    ],
  ] as const) {
    const content = readFileSync(
      join(packageRoot, "src/neo-brutalist", relativePath),
    );
    assert.equal(
      createHash("sha256").update(content).digest("hex"),
      expectedSha256,
    );
  }
});

test("media picker image-plus retains every path and circle from the fixed official bundle", () => {
  const bundle = readFileSync(
    join(
      repositoryRoot,
      "docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js",
    ),
    "utf8",
  );
  const source = bundle.match(/const k3e=(\[.*?\]),\w+=Et\("image-plus"/u)?.[1];
  assert.ok(source);
  const sprite = readFileSync(
    join(packageRoot, "src/interaction-icons.svg"),
    "utf8",
  ).match(/<symbol id="raft-icon-image-plus"[\s\S]*?<\/symbol>/u)?.[0];
  assert.ok(sprite);
  assert.deepEqual(
    [...sprite.matchAll(/<path d="([^"]+)"/gu)].map((m) => m[1]),
    [...source.matchAll(/\["path",\{d:"([^"]+)"/gu)].map((m) => m[1]),
  );
  assert.match(source, /\["circle",\{cx:"9",cy:"9",r:"2"/u);
  assert.match(sprite, /<circle cx="9" cy="9" r="2"/u);
});

test("2026-09-08 additional glyphs exactly match the separately frozen source geometry", () => {
  const evidence = JSON.parse(
    readFileSync(
      join(repositoryRoot, "docs/evidence/raft-icon-semantics-20260908.json"),
      "utf8",
    ),
  );
  const sprite = readFileSync(
    join(packageRoot, "src/interaction-icons.svg"),
    "utf8",
  );
  for (const icon of evidence.icons) {
    const upstream = readFileSync(join(repositoryRoot, icon.source));
    assert.equal(
      createHash("sha256").update(upstream).digest("hex"),
      icon.sha256,
      icon.name,
    );
    assert.equal(icon.offsetUnit, "utf8-bytes");
    const declaration = upstream.subarray(icon.offset).toString("utf8");
    assert.ok(declaration.startsWith(`const ${icon.array}=`), icon.name);
    const array = declaration.match(/^const \w+=(\[\[.*?\]\]),/u)?.[1];
    assert.ok(array, icon.name);
    const geometry = JSON.parse(
      array.replace(/([{,])([A-Za-z_]\w*):/gu, '$1"$2":'),
    );
    assert.deepEqual(
      icon.geometry,
      geometry,
      `${icon.name} manifest must derive from unchanged upstream`,
    );
    const symbol = sprite.match(
      new RegExp(
        `<symbol (id="raft-icon-${icon.name}"[^>]*)>([\\s\\S]*?)<\\/symbol>`,
        "u",
      ),
    );
    assert.ok(symbol, icon.name);
    const attributes = Object.fromEntries(
      [...symbol[1]!.matchAll(/([\w-]+)="([^"]*)"/gu)].map(([, key, value]) => [
        key,
        value,
      ]),
    );
    assert.deepEqual(attributes, {
      id: `raft-icon-${icon.name}`,
      viewBox: "0 0 24 24",
      ...(icon.name === "play"
        ? {}
        : {
            fill: "none",
            stroke: "currentColor",
            "stroke-width": "2",
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
          }),
    });
    const body = symbol[2]!;
    assert.equal(
      body
        .replace(/<(?:path|circle|line|rect|polyline|polygon)\b[^>]*\/>/gu, "")
        .trim(),
      "",
      "unknown nested elements must not escape the frozen sprite check",
    );
    const actual = [
      ...body.matchAll(
        /<(path|circle|line|rect|polyline|polygon)\b([^>]*?)\/?>(?:<\/\1>)?/gu,
      ),
    ].map(([, tag, attributes]) => [
      tag,
      Object.fromEntries(
        [...attributes!.matchAll(/([\w-]+)="([^"]*)"/gu)].map(
          ([, key, value]) => [key, value],
        ),
      ),
    ]);
    const expected = icon.geometry.map(
      ([tag, attributes]: [string, Record<string, string>]) => [
        tag,
        Object.fromEntries(
          Object.entries(attributes).filter(([key]) => key !== "key"),
        ),
      ],
    );
    assert.deepEqual(actual, expected, icon.name);
  }
});

// index-BVfbaScj.js O$e/U$e/z$e; independently frozen additions, not a new baseline.
test("Thread action glyph additions retain their separately reviewed Raft geometry", () => {
  const source = readFileSync(
    join(packageRoot, "src", "interaction-icons.svg"),
    "utf8",
  );
  const block = source.match(
    /  <!-- Verbatim Lucide[^\n]*\n(?:  <symbol id="raft-icon-(?:map-pin|message-circle-plus|message-circle-off)"[^\n]*\n){3}/u,
  )?.[0];
  assert.ok(block);
  assert.equal(
    createHash("sha256").update(block).digest("hex"),
    "c7d7b08b1a147ef528975e266961af3294b1d90c831e778c885bdd2cb37dfa49",
  );
});

test("Search common star preserves Raft vHe/yHe geometry", () => {
  const source = readFileSync(
    join(packageRoot, "src", "interaction-icons.svg"),
    "utf8",
  );
  assert.equal(
    source.match(/id="raft-icon-star"[^>]*><path d="([^"]+)"/u)?.[1],
    "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
  );
});

test("member graph git-branch is the separately verified Raft I6e geometry", () => {
  const source = readFileSync(
    join(packageRoot, "src", "interaction-icons.svg"),
    "utf8",
  );
  assert.ok(source.includes(verifiedGitBranchAddition));
  assert.equal(source.split('id="raft-icon-git-branch"').length, 2);
});

test("thread header icons preserve the current Raft Lucide geometry", () => {
  const sprite = readFileSync(
    join(packageRoot, "src", "interaction-icons.svg"),
    "utf8",
  );
  assert.ok(sprite.includes(verifiedThreadIconsAddition));
  assert.equal(sprite.split('id="raft-icon-ellipsis-vertical"').length, 2);
  assert.equal(sprite.split('id="raft-icon-external-link"').length, 2);
});

test("file-comment references use Raft x6e/jy file-text geometry", () => {
  const sprite = readFileSync(
    join(packageRoot, "src", "interaction-icons.svg"),
    "utf8",
  );
  assert.ok(sprite.includes(verifiedFileTextAddition));
});

test("preview comment toggle uses Raft lVe/Hse three-dot bubble geometry", () => {
  const sprite = readFileSync(
    join(packageRoot, "src", "interaction-icons.svg"),
    "utf8",
  );
  assert.ok(sprite.includes(verifiedCommentToggleAddition));
});
