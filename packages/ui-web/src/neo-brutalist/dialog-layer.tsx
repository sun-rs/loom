import type { HTMLAttributes } from "react";
import { createPortal } from "react-dom";

/** Modal chrome belongs to the viewport, independently of responsive panes. */
export function DialogLayer(props: HTMLAttributes<HTMLDivElement>) {
  return createPortal(<div {...props} />, document.body);
}
