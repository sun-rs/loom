// Mounts the real `.sq-btn` / `.send-btn` rules from the shipped product
// stylesheets so scripts/run-sq-btn-spec-browser-gate.mjs can read computed
// styles out of a real Chrome. Fixture only; never a product surface.
import { createRoot } from "react-dom/client";
import "../src/product-styles.ts";

const Icon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 4h16v16H4z" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

createRoot(document.getElementById("root")!).render(
  <div className="rah-product-shell" style={{ padding: 40 }}>
    <div style={{ display: "flex", gap: 8 }}>
      <button type="button" className="sq-btn" data-probe="sq-btn">
        <Icon />
      </button>
      <button
        type="button"
        className="sq-btn"
        data-probe="sq-btn-disabled"
        disabled
      >
        <Icon />
      </button>
      <button type="button" className="sq-btn sm" data-probe="sq-btn-sm">
        <Icon />
      </button>
    </div>
    {/* The narrow-viewport branch in product.css targets `.head-actions`, so
        the header square button needs its real ancestor to be measurable. */}
    <div className="rah-conversation-head" style={{ display: "flex" }}>
      <div className="head-actions">
        <button type="button" className="sq-btn" data-probe="head-sq-btn">
          <Icon />
        </button>
      </div>
    </div>
    <div className="composer-bar" style={{ marginTop: 24 }}>
      <button type="button" className="sq-btn" data-probe="composer-sq-btn">
        <Icon />
      </button>
      {/* The real attachment picker (packages/ui-web/src/neo-brutalist/
          composer-attachment-pickers.tsx) renders `sq-btn rah-composer-picker`
          inside `.rah-composer-pickers`, so channel-extras.css reaches this
          component through a selector that never spells `.sq-btn`. The probe
          exists so the element-based coverage check can see those rules. */}
      <div className="rah-composer-pickers">
        <button
          type="button"
          className="sq-btn rah-composer-picker"
          data-probe="composer-picker"
        >
          <Icon />
        </button>
        <button
          type="button"
          className="sq-btn rah-composer-picker"
          data-probe="composer-picker-disabled"
          disabled
        >
          <Icon />
        </button>
      </div>
      <button type="button" className="send-btn" data-probe="send-btn">
        <Icon />
      </button>
      <button
        type="button"
        className="send-btn"
        data-probe="send-btn-disabled"
        disabled
      >
        <Icon />
      </button>
    </div>
  </div>,
);
