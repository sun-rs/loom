import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readUiSource as read } from "./ui-source.ts";

test("the product owns one Raft-derived interaction state protocol", () => {
  const entry = read("product-styles.ts");
  const protocol = read("interaction-state.css");

  assert.match(entry, /@rah-os\/ui-tokens\/neo-brutalist\.css/u);
  assert.match(
    protocol,
    /--rah-interaction-transition:\s*150ms cubic-bezier\(0\.4, 0, 0\.2, 1\)/u,
  );
  assert.match(
    protocol,
    /--rah-press-transition:\s*100ms cubic-bezier\(0\.4, 0, 0\.2, 1\)/u,
  );
  assert.match(protocol, /--rah-brutal-lift-rest-shadow:\s*var\(--shadow-s\)/u);
  assert.match(
    protocol,
    /--rah-brutal-lift-hover-transform:\s*translateY\(-1px\)/u,
  );
  assert.match(
    protocol,
    /--rah-brutal-lift-hover-shadow:\s*var\(--shadow-m\)/u,
  );
  assert.match(
    protocol,
    /--rah-brutal-lift-active-transform:\s*translate\(1px, 1px\)/u,
  );
  assert.match(
    protocol,
    /--rah-brutal-lift-active-shadow:\s*var\(--shadow-press\)/u,
  );
  assert.match(
    protocol,
    /:where\(\.rah-product-shell, \.rah-dialog-layer\) :where\(button\)/u,
  );
  assert.match(
    protocol,
    /\.rah-interaction-row:not\(:disabled\):not\(\.is-selected\):not\(\.is-active\):hover/u,
  );
  assert.match(protocol, /\.rah-interaction-flat:hover/u);
  assert.match(protocol, /\.rah-interaction-brutal:hover/u);
  assert.match(protocol, /\.rah-interaction-brutal:active/u);
  assert.match(
    protocol,
    /\.rah-interaction-brutal\s*\{[\s\S]*?box-shadow:\s*var\(--rah-brutal-lift-rest-shadow\)/u,
  );
  assert.match(
    protocol,
    /\.rah-interaction-shadow-host\s*\{[\s\S]*?overflow:\s*visible/u,
  );
  assert.match(protocol, /\.rah-interaction-segment\[aria-checked="true"\]/u);
  assert.match(protocol, /\.rah-product-shell \.rail-logo \{/u);
  assert.match(
    protocol,
    /\.rah-product-shell \.rail-logo:hover:not\(:disabled\) \{[\s\S]*?box-shadow:\s*var\(--shadow-m\)/u,
  );
  assert.match(protocol, /\.rah-product-shell :is\(\.sq-btn, \.send-btn\) \{/u);
  assert.match(
    protocol,
    /\.rah-product-shell :is\(\.sq-btn, \.send-btn\):hover:not\(:disabled\) \{[\s\S]*?transform:\s*translateY\(-1px\)/u,
  );
  assert.match(
    protocol,
    /\.rah-product-shell :is\(\.sq-btn, \.send-btn\):active:not\(:disabled\) \{[\s\S]*?transform:\s*translate\(1px, 1px\)/u,
  );
  assert.doesNotMatch(protocol, /\btranslate:\s*(?:0 -1px|1px 1px)/u);
  assert.match(
    protocol,
    /\.rah-product-shell :is\(\.sq-btn, \.send-btn, \.btn\):disabled:hover \{[\s\S]*?box-shadow:\s*var\(--shadow-s\)/u,
  );
  assert.match(protocol, /\.rah-interaction-flat:hover:not\(:disabled\)/u);
  assert.match(protocol, /\.rah-interaction-segment:hover:not\(:disabled\)/u);
  assert.match(
    protocol,
    /\.rah-product-shell \.task-filter-trigger \{[\s\S]*?transition-timing-function:\s*cubic-bezier\(0\.4, 0, 0\.2, 1\)/u,
  );
  assert.match(
    protocol,
    /\.rah-product-shell :is\(\.activity-filter, \.rah-interaction-segment, \.tab\) \{[\s\S]*?transition:\s*none/u,
  );
  assert.match(
    protocol,
    /\.rah-product-shell \.tab \{[\s\S]*?cursor:\s*default/u,
  );
  assert.match(
    protocol,
    /\.rah-product-shell \.activity-done \{[\s\S]*?opacity:\s*0;[\s\S]*?transition:\s*opacity var\(--rah-press-transition\)/u,
  );
  assert.match(protocol, /\.rah-product-shell \.btn \{/u);
  assert.match(
    protocol,
    /\.rah-settings-form-actions \.btn:disabled \{[\s\S]*?opacity:\s*0\.5/u,
  );
});

test("source-backed interaction exceptions stay explicit", () => {
  const identity = read("identity-interactions.css");
  const messageSocial = read("message-social.css");
  const messageSocialComponent = read("components/message-social.tsx");
  const discoveryFilter = read("components/discovery-filter.tsx");
  const product = read("settings.css");

  assert.match(
    identity,
    /\.rah-sidebar-disclosure \{[\s\S]*?cursor:\s*default;[\s\S]*?transition:\s*color var\(--rah-interaction-transition\)/u,
  );
  assert.match(
    product,
    /\.rah-settings-form-card input[\s\S]*?height:\s*40px/u,
  );
  assert.match(
    product,
    /\.rah-settings-profile-editor \{[\s\S]*?max-width:\s*none/u,
  );
  assert.match(
    product,
    /\.rah-settings-form-actions \.btn \{[\s\S]*?font-size:\s*12px;[\s\S]*?height:\s*32px/u,
  );
  assert.match(
    messageSocial,
    /\.msg-actions \{[\s\S]*?transition:\s*opacity var\(--rah-interaction-transition\)/u,
  );
  assert.match(
    messageSocial,
    /\.msg-actions \.msg-action-btn,[\s\S]*?\.msg-actions \.rah-reaction-picker > button \{[\s\S]*?transition:\s*none/u,
  );
  assert.match(
    messageSocial,
    /\.msg-actions \.msg-action-btn:hover,[\s\S]*?background:\s*var\(--soft-signal\)/u,
  );
  assert.match(
    messageSocial,
    /\.rah-discovery-popover\.is-reaction[\s\S]*?button:hover:not\(:disabled\)[\s\S]*?var\(--pink\)[\s\S]*?20%/u,
  );
  assert.match(
    messageSocial,
    /\.rah-discovery-popover\.is-reaction[\s\S]*?> button \{[\s\S]*?padding:\s*0;[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*center;[\s\S]*?border-radius:\s*4px/u,
  );
  assert.match(
    messageSocial,
    /\.msg-actions \.msg-action-btn\.is-saved[\s\S]*?color:\s*var\(--orange\)/u,
  );
  assert.match(
    messageSocial,
    /\.rah-message-social-summary \{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?gap:\s*6px/u,
  );
  assert.match(
    messageSocial,
    /\.rah-message-saved-badge \{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;[\s\S]*?height:\s*20px;[\s\S]*?overflow:\s*hidden;[\s\S]*?white-space:\s*nowrap;[\s\S]*?var\(--orange\)/u,
  );
  assert.match(
    messageSocial,
    /\.rah-message-saved-badge:hover:not\(:disabled\) \{[\s\S]*?filter:\s*brightness\(0\.9\)/u,
  );
  assert.match(
    messageSocial,
    /\.rah-message-reaction-slot \{[\s\S]*?display:\s*inline-flex/u,
  );
  assert.match(
    messageSocial,
    /\.rah-message-reaction \{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;[\s\S]*?height:\s*20px;[\s\S]*?overflow:\s*hidden;[\s\S]*?white-space:\s*nowrap/u,
  );
  assert.match(
    messageSocial,
    /\.rah-message-reaction-icon \{[\s\S]*?display:\s*inline-flex;[\s\S]*?align-items:\s*center;[\s\S]*?line-height:\s*1/u,
  );
  assert.match(
    messageSocial,
    /\.rah-message-reaction-count \{[\s\S]*?font-family:\s*var\(--mono\);[\s\S]*?font-variant-numeric:\s*tabular-nums/u,
  );
  assert.match(discoveryFilter, /REACTION_HOVER_CLOSE_MS = 120/u);
  assert.match(messageSocialComponent, /label: `用 \$\{emoji\} 回应`/u);
  assert.match(messageSocialComponent, /function BookmarkGlyph/u);
  assert.match(
    messageSocialComponent,
    /d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1\.496\.868/u,
  );
  assert.match(messageSocialComponent, /filled=\{Boolean\(data\?\.saved\)\}/u);
  assert.match(
    messageSocialComponent,
    /className="rah-message-social-summary"/u,
  );
  assert.match(
    discoveryFilter,
    /title=\{[\s\S]*?variant === "reaction" \? option\.label/u,
  );
  assert.match(messageSocialComponent, /className="rah-message-saved-badge"/u);
  assert.match(
    messageSocialComponent,
    /className="rah-message-reaction-slot"/u,
  );
  assert.match(
    messageSocialComponent,
    /className="rah-message-reaction-icon"/u,
  );
  assert.match(
    messageSocialComponent,
    /className="rah-message-reaction-count"/u,
  );
  assert.match(messageSocialComponent, /createPortal/u);
  assert.match(
    messageSocialComponent,
    /data-message-affordance="reaction-reactors-popover"/u,
  );
  assert.match(messageSocialComponent, /onMouseEnter=/u);
  assert.match(messageSocialComponent, /onMouseLeave=/u);
  assert.match(messageSocialComponent, /onFocus=/u);
  assert.match(messageSocialComponent, /onBlur=/u);
  assert.match(
    messageSocial,
    /\.rah-reaction-reactors-popover \{[\s\S]*?position:\s*fixed;[\s\S]*?z-index:\s*80;[\s\S]*?pointer-events:\s*none;[\s\S]*?max-width:\s*280px;[\s\S]*?border:\s*2px solid var\(--black\);[\s\S]*?padding:\s*6px 8px;[\s\S]*?font:\s*700 12px\/20px/u,
  );
});

test("navigation and identity controls opt into the shared interaction families", () => {
  const settings = read("components/settings-surface.tsx");
  const agents = read("components/agent-directory-pane.tsx");
  const agentSidebar = read("components/agent-sidebar.tsx");
  const computers = read("components/workspace-catalog-panes.tsx");
  const discoveryFilter = read("components/discovery-filter.tsx");
  const workspaceNavigation = read("components/workspace-navigation.tsx");

  assert.match(settings, /rah-interaction-row/u);
  assert.match(agentSidebar, /rah-agent-member-row rah-interaction-row/u);
  assert.match(agents, /rah-profile-edit rah-interaction-flat/u);
  assert.match(agents, /rah-interaction-brutal/u);
  assert.match(computers, /rah-computer-row rah-interaction-row/u);
  assert.match(
    discoveryFilter,
    /variant === "sidebar" \? " rah-interaction-flat"/u,
  );
  assert.match(
    workspaceNavigation,
    /className="rah-side-create rah-interaction-flat"/u,
  );
});

test("the Raft strong-lift source inventory and local consumers remain auditable", () => {
  const evidence = JSON.parse(
    readFileSync(
      new URL(
        "../../../docs/evidence/raft-brutal-lift-inventory-20260903.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    asset: { sha256: string; url: string };
    occurrences: Array<{
      activeOffset: 1 | 2;
      id: string;
      localDisposition: string;
    }>;
    release: { commitSha: string };
    schemaVersion: number;
    signature: string[];
  };
  const taskBoard = read("components/global-task-board.tsx");
  const agents = read("components/agent-directory-pane.tsx");
  const agentStyles = read("agent-directory.css");

  assert.equal(evidence.schemaVersion, 1);
  assert.equal(
    evidence.release.commitSha,
    "16856201b6d089c251967fe2afdb2b0a0dcbb1a0",
  );
  assert.equal(
    evidence.asset.url,
    "https://app.raft.build/assets/index-Biin3FEA.js",
  );
  assert.equal(
    evidence.asset.sha256,
    "e798f35bde09eeda2927669406e10718392ff7574796016441def59dbc5b05f9",
  );
  assert.deepEqual(evidence.signature, [
    "shadow-brutal-sm",
    "transition-all",
    "duration-100",
    "hover:-translate-y-[1px]",
    "hover:shadow-brutal",
    "active:translate-x-[1px|2px]",
    "active:translate-y-[1px|2px]",
    "active:shadow-brutal-active",
  ]);
  assert.equal(evidence.occurrences.length, 7);
  assert.equal(
    evidence.occurrences.filter((item) => item.activeOffset === 1).length,
    5,
  );
  assert.equal(
    evidence.occurrences.filter((item) => item.activeOffset === 2).length,
    2,
  );
  assert.equal(
    evidence.occurrences.find((item) => item.id === "task-card")
      ?.localDisposition,
    "adopted",
  );
  assert.match(taskBoard, /rah-global-task-card rah-interaction-brutal/u);
  assert.match(agents, /className="rah-interaction-brutal"/u);
  assert.doesNotMatch(
    agentStyles,
    /\.rah-agent-profile-actions button:(?:hover|active)/u,
  );
});

test("search, tasks, and account settings do not leak native browser button states", () => {
  const discovery = read("components/global-discovery.tsx");
  const taskToolbar = read("components/task-toolbar.tsx");
  const settings = read("components/settings-pages.tsx");

  assert.match(discovery, /rah-search-suggestion rah-interaction-flat/u);
  assert.match(discovery, /rah-search-clear rah-interaction-flat/u);
  assert.match(taskToolbar, /rah-interaction-segment/u);
  assert.match(settings, /const profileDirty =/u);
  assert.match(
    settings,
    /disabled=\{\s*!principal \|\| pending \|\| !displayName\.trim\(\) \|\| !profileDirty\s*\}/u,
  );
});
