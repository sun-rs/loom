// Mounts the real chat message row family from the shipped product
// stylesheets so scripts/run-message-row-spec-browser-gate.mjs can read
// computed styles out of a real Chrome. Fixture only; never a product surface.
//
// The markup mirrors apps/web/src/components/conversation-panes.tsx: the spec's
// rules are descendant-scoped (`.msg > .avatar`, `.msg-head b`, `.tp-line time`),
// so the real ancestors have to be present or nothing matches.
//
// The compact row (`.msg.is-compact`) is the one element the product does not
// render yet: docs/design/component-specs/message-row.zh-CN.md 改动边界 4 ports
// upstream `eat()` grouping, and the probe exists here first so the batch has a
// before-reading to compare against.
import { createRoot } from "react-dom/client";
import "../src/product-styles.ts";

const Glyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 4h16v16H4z" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const FirstRow = () => (
  <article className="msg" data-probe="msg-first" tabIndex={-1}>
    <span className="avatar rah-avatar" data-probe="msg-avatar">
      A
    </span>
    <div className="msg-body">
      <header className="msg-head" data-probe="msg-head">
        <b data-probe="msg-author">Agent Council</b>
        <time data-probe="msg-time">09:41</time>
      </header>
      <div className="rah-message-markdown">
        <p>第一条消息的正文，用来量行高。</p>
      </div>
    </div>
  </article>
);

// The compact row the grouping port will render: no avatar, no author line, a
// 36px spacer whose hover-revealed 10px mono time sits in its top right.
const CompactRow = () => (
  <article className="msg is-compact" data-probe="msg-compact" tabIndex={-1}>
    <span className="msg-compact-gutter" data-probe="msg-compact-gutter">
      <time data-probe="msg-compact-time">09:42</time>
    </span>
    <div className="msg-body">
      <div className="rah-message-markdown">
        <p>同组后续消息。</p>
      </div>
    </div>
  </article>
);

const SystemRow = () => (
  <p className="rah-chat-system-notice" data-probe="msg-system">
    系统提示：Agent Council 加入了频道。
  </p>
);

const TaskBadgeRow = () => (
  <article className="msg" data-probe="msg-with-task" tabIndex={-1}>
    <span className="avatar rah-avatar">A</span>
    <div className="msg-body">
      <header className="msg-head">
        <b>Agent Council</b>
        <span className="msg-role" data-probe="msg-role">
          Onboarding Assistant
        </span>
        <time>09:43</time>
      </header>
      <div className="rah-message-markdown">
        <p>带任务徽标与线程预览的行。</p>
      </div>
      <button
        className="rah-message-task-link"
        data-probe="msg-task-badge"
        data-task-status="in_review"
        type="button"
      >
        <Glyph />
        <span>#12</span>
        <span>@council</span>
      </button>
      <button
        className="thread-preview"
        data-probe="thread-preview"
        type="button"
      >
        <span className="tp-toggle" data-probe="thread-preview-toggle">
          3 条回复 ›
        </span>
        <span className="tp-line" data-probe="thread-preview-line">
          <span
            className="avatar xs rah-avatar"
            data-probe="thread-preview-avatar"
          >
            B
          </span>
          <b>Builder</b>
          <span className="tp-text">最近一条回复的正文</span>
          <time data-probe="thread-preview-time">17:03</time>
        </span>
      </button>
    </div>
  </article>
);

const DateDivider = () => (
  <div
    className="rah-chat-date-divider"
    data-probe="date-divider"
    role="separator"
  >
    <span aria-hidden="true" data-probe="date-divider-line" />
    <time data-probe="date-divider-label">今天</time>
  </div>
);

createRoot(document.getElementById("root")!).render(
  <div className="rah-product-shell" style={{ padding: 40 }}>
    {/* `.messages` is the real scroll owner the message rules are written
        against; the explicit width is fixture scaffolding only. */}
    <div className="messages" style={{ width: 760 }}>
      <DateDivider />
      <FirstRow />
      <CompactRow />
      <SystemRow />
      <TaskBadgeRow />
    </div>
  </div>,
);
