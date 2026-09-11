// Mounts the real chat-sidebar row family from the shipped product
// stylesheets so scripts/run-sidebar-row-spec-browser-gate.mjs can read
// computed styles out of a real Chrome. Fixture only; never a product surface.
//
// The markup mirrors the product exactly, because the spec's rules are
// descendant-scoped: `.sidebar .channel-row:not(.is-selected):hover` needs the
// real `.sidebar` ancestor, `.rah-sidebar-disclosure > .count` needs the real
// disclosure button, and the sort trigger is what
// apps/web/src/components/discovery-filter.tsx renders for `variant="sidebar"`.
import { createRoot } from "react-dom/client";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import "../src/product-styles.ts";

const HashIcon = () => (
  <svg className="row-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" stroke="currentColor" />
  </svg>
);

const Chevron = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m9 18 6-6-6-6" stroke="currentColor" fill="none" />
  </svg>
);

const Glyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 4h16v16H4z" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

// The section header, rendered exactly as apps/web/src/components/
// sidebar-section.tsx does, with the action slot workspace-navigation.tsx
// fills: the DiscoveryFilter sidebar trigger plus the create button.
const SectionHead = ({
  label,
  probeSuffix,
  disabled = false,
}: {
  label: string;
  probeSuffix: string;
  disabled?: boolean;
}) => (
  <div className="side-title">
    <button
      type="button"
      className="rah-sidebar-disclosure"
      aria-expanded="true"
      data-probe={`sidebar-disclosure${probeSuffix}`}
    >
      <Chevron />
      <span>{label}</span>
      <span className="count" data-probe={`sidebar-count${probeSuffix}`}>
        3
      </span>
    </button>
    <div className="rah-sidebar-section-actions">
      <div className="rah-sidebar-sort">
        <button
          type="button"
          className="task-filter-trigger rah-interaction-flat"
          aria-label={`${label}排序`}
          disabled={disabled}
          data-probe={`sidebar-sort${probeSuffix}`}
        >
          <Glyph />
          <Glyph />
        </button>
      </div>
      <button
        aria-label="新建频道"
        className="rah-side-create rah-interaction-flat"
        disabled={disabled}
        title="新建频道"
        data-probe={`sidebar-create${probeSuffix}`}
      >
        <Icon name="plus" />
      </button>
    </div>
  </div>
);

createRoot(document.getElementById("root")!).render(
  <div className="rah-product-shell" style={{ padding: 40 }}>
    {/* `.sidebar` is `flex-direction: column; min-height: 0` and `.sidebar-body`
        is `flex: 1`, so without an explicit height the body collapses to 0 and
        every row is `hidden`. The height is fixture scaffolding only; no spec'd
        property reads from it. */}
    <div
      className="sidebar"
      data-probe="sidebar"
      style={{ width: 320, height: 520 }}
    >
      <div className="sidebar-body">
        <button
          type="button"
          className="sidebar-bookmarks"
          data-probe="sidebar-bookmarks"
        >
          <Glyph />
          <span>已保存</span>
        </button>
        <section className="side-section">
          <SectionHead label="频道" probeSuffix="" />
          <div>
            <a className="channel-row" href="#" data-probe="channel-row">
              <HashIcon />
              <span className="rah-sidebar-channel-name">test</span>
            </a>
            <a
              className="channel-row is-selected"
              href="#"
              data-probe="channel-row-selected"
            >
              <HashIcon />
              <span className="rah-sidebar-channel-name">general</span>
            </a>
          </div>
        </section>
        <section className="side-section">
          <SectionHead label="私信" probeSuffix="-disabled" disabled />
          <div>
            <a
              className="channel-row rah-direct-room-row"
              href="#"
              data-probe="direct-room-row"
            >
              <span
                className="rah-direct-room-fallback"
                data-probe="direct-room-avatar"
              >
                A
              </span>
              <span className="rah-direct-row-identity">
                <b className="rah-direct-row-name">Agent Council</b>
                <small data-probe="direct-room-small">协调者</small>
              </span>
            </a>
          </div>
        </section>
      </div>
    </div>
  </div>,
);
