/** Narrow, checked build-time integration; frozen source remains unchanged. */
function replaceOnce(source: string, from: string, to: string) {
  if (source.split(from).length !== 2)
    throw Error("Official thread boundary changed; review adaptation");
  return source.replace(from, to);
}
export function adaptThreadItem(source: string) {
  let code = replaceOnce(
    source,
    "onClick={readOnlyProjection ? undefined : handleMobileTap}",
    "onClick={readOnlyProjection && !(onOpenThread && !hideThreadActions) ? undefined : handleMobileTap}",
  );
  code = replaceOnce(
    code,
    "      /> : null}\n      {showSelectedGroupedHeader ?",
    "      /> : onOpenThread && !hideThreadActions ? <LoomThreadToolbar onReplyInThread={handleReplyInThread} /> : null}\n      {showSelectedGroupedHeader ?",
  );
  return 'import LoomThreadToolbar from "loom-thread-toolbar";\n' + code;
}
/** Local send override follows Loom's Enter contract, including touch keyboards. */
export function adaptComposerSubmit(source: string) {
  return replaceOnce(
    source,
    'if (typeof window !== "undefined" &&\n        window.matchMedia("(pointer: coarse) and (orientation: portrait)").matches)',
    'if (!onSendOverride && typeof window !== "undefined" &&\n        window.matchMedia("(pointer: coarse) and (orientation: portrait)").matches)',
  );
}
