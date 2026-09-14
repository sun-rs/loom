import { useEffect, useState } from "react";

/** Presentation only: never clear the navigation target, query or scroll anchor.
 * Capture runs before button handlers: a navigation click dismisses the old
 * highlight, then its handler can reveal the new one (including the same target).
 * An effect installed after navigation cannot capture its originating click. */
export function useMessageHighlight(key: string | undefined) {
  const [revision, setRevision] = useState(0);
  const [dismissed, setDismissed] = useState<string>();
  const token = key === undefined ? undefined : JSON.stringify([key, revision]);
  const visible = token !== undefined && dismissed !== token;
  useEffect(() => {
    if (!visible) return;
    const dismiss = () => setDismissed(token);
    document.addEventListener("click", dismiss, true);
    return () => document.removeEventListener("click", dismiss, true);
  }, [token, visible]);
  return { visible, reveal: () => setRevision((value) => value + 1) };
}
