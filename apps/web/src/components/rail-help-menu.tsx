import { HintTooltip } from "@rah-os/ui-web/neo-brutalist/tooltip";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";

/** User-requested direct guide entry; no resource popover. */
export function RailHelpMenu() {
  return (
    <div className="rail-footer-item">
      <HintTooltip content="帮助">
        <button
          type="button"
          className="rail-btn"
          aria-label="帮助"
          onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.set("surface", "settings");
            url.searchParams.set("settingsSection", "docs");
            window.location.assign(url.toString());
          }}
        >
          <Icon name="circle-question-mark" />
        </button>
      </HintTooltip>
    </div>
  );
}
