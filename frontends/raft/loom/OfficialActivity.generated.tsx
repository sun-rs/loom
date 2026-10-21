// GENERATED exact official timeline primitives; no upstream store or socket.
import type {ReactNode} from "react";
import {Status,type Presence} from "raft-ui";
type FormatTimestamp = (timestamp:number)=>string;
const LOG_ITEM_CLASS = [
  "relative grid grid-cols-[9px_minmax(0,1fr)_auto] gap-x-3 py-1.5",
  "before:absolute before:top-0 before:bottom-0 before:left-1 before:border-l before:border-line-hairline",
  "first:before:top-4 last:before:bottom-auto last:before:h-4 only:before:hidden",
].join(" ");

const LOG_PIXEL_CLASS = "z-[1] mt-[5.5px] shadow-[0_0_0_2px_var(--layer-canvas)]";

const LOG_TITLE_CLASS = "font-mono text-mono-code text-foreground-muted wrap-anywhere";

const LOG_DETAIL_CLASS = "mt-0.5 font-mono text-mono-meta text-foreground-hint wrap-anywhere";

const LOG_TIME_CLASS = "font-mono text-mono-meta leading-5 whitespace-nowrap text-foreground-hint";

function LogItem({ presence, timestamp, formatTimestamp, children }: { presence: Presence; timestamp: number; formatTimestamp: FormatTimestamp; children: ReactNode }) {
  return (
    <li className={LOG_ITEM_CLASS}>
      <Status aria-hidden="true" presence={presence} className={LOG_PIXEL_CLASS} />
      <div className="min-w-0">{children}</div>
      <span className={LOG_TIME_CLASS}>{formatTimestamp(timestamp)}</span>
    </li>
  );
}
export {LogItem,LOG_TITLE_CLASS,LOG_DETAIL_CLASS};
