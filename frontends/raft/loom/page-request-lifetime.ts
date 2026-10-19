/** Stop new requests before WebKit tears down the document. A persisted
 * pageshow must create a fresh signal; an aborted controller is never reused. */
export function observePageRequestLifetime(
  target: EventTarget,
  controller: AbortController,
  resume: () => void,
  mayLeave: () => boolean = () => true,
): () => void {
  const hide = () => controller.abort();
  // Unknown writes can cancel navigation. Keep their page readable until it
  // actually leaves; pagehide remains the unconditional final boundary.
  const leave = () => {
    if (mayLeave()) hide();
  };
  const show = (event: Event) => {
    if ((event as PageTransitionEvent).persisted && controller.signal.aborted)
      resume();
  };
  target.addEventListener("beforeunload", leave);
  target.addEventListener("pagehide", hide);
  target.addEventListener("pageshow", show);
  return () => {
    target.removeEventListener("beforeunload", leave);
    target.removeEventListener("pagehide", hide);
    target.removeEventListener("pageshow", show);
    controller.abort();
  };
}
