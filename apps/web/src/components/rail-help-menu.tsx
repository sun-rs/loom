import { useState } from "react";
import {
  InteractivePopover,
  InteractivePopoverContent,
  InteractivePopoverTrigger,
} from "@rah-os/ui-web/neo-brutalist/interactive-popover";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";

/** Raft Help's anchored resource menu, limited to the local product's real guide. */
export function RailHelpMenu() {
  const [open, setOpen] = useState(false);
  return (
    <InteractivePopover open={open} onOpenChange={setOpen}>
      <div className="rail-footer-item">
        <InteractivePopoverTrigger
          hover
          render={
            <button
              type="button"
              className={`rail-btn${open ? " is-active" : ""}`}
              aria-label="帮助"
              aria-haspopup="dialog"
              aria-expanded={open}
            >
              <Icon name="circle-question-mark" />
            </button>
          }
        />
        <InteractivePopoverContent
          blocked={false}
          label="帮助与资源"
          className="rah-rail-help-menu"
        >
          <header>帮助与资源</header>
          <a
            href="/help/local-workbench.html"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            <Icon name="book-open" />
            <span>本机操作指南</span>
          </a>
        </InteractivePopoverContent>
      </div>
    </InteractivePopover>
  );
}
