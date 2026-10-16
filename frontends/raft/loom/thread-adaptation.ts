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
export function adaptThreadFooter(source: string) {
  let code = replaceOnce(
    source,
    "  readOnlyData?: ReadOnlyThreadData;",
    '  readOnlyData?: ReadOnlyThreadData;\n  loomFooter?: ReactNode;\n  loomHeaderActions?: ReactNode;\n  loomOnOpenProfile?: (kind: "agent" | "human", id: string) => void;\n  loomFocusId?: string;\n  loomHasNewer?: boolean;\n  loomLoadNewer?: () => Promise<void>;',
  );
  code = replaceOnce(
    code,
    "  readOnlyData,\n}: ThreadPanelProps &",
    "  readOnlyData,\n  loomFooter,\n  loomHeaderActions,\n  loomOnOpenProfile,\n  loomFocusId,\n  loomHasNewer,\n  loomLoadNewer,\n  hideParentMessage,\n  parentSlot,\n}: ThreadPanelProps &",
  );
  code = replaceOnce(
    code,
    '  const parent = (\n    <div data-testid="thread-panel-parent"',
    '  const parent = parentSlot ?? (hideParentMessage ? null : (\n    <div data-testid="thread-panel-parent"',
  );
  code = replaceOnce(
    code,
    "  );\n\n  return (\n    <ThreadPanelRoot className={READ_ONLY_THREAD_PANEL_CLASS_NAME}",
    "  ));\n\n  return (\n    <ThreadPanelRoot className={READ_ONLY_THREAD_PANEL_CLASS_NAME}",
  );
  code = replaceOnce(
    code,
    'readOnlyData.error ? (\n          <div className="flex h-full flex-col overflow-auto">\n            {parent}',
    'readOnlyData.error ? (\n          <div className="flex h-full flex-col overflow-auto">',
  );
  code = replaceOnce(
    code,
    "    hasNewer: false,",
    "    hasNewer: loomHasNewer ?? false,\n    initialFocusMessageId: loomFocusId,\n    sentinelAutoLoadBlockKey: loomFocusId,",
  );
  code = replaceOnce(
    code,
    "    loadNewer: () => undefined,",
    "    loadNewer: loomLoadNewer ?? (() => undefined),",
  );
  code = replaceOnce(
    code,
    "  }), [readOnlyData.hasOlder,",
    "  }), [loomFocusId, loomHasNewer, loomLoadNewer, readOnlyData.hasOlder,",
  );
  code = replaceOnce(
    code,
    "        readOnlySender={readOnlyData.senderByMessageId.get(message.id)}",
    "        onOpenProfile={loomOnOpenProfile}\n        threadSearchActive={message.id === loomFocusId}\n        readOnlySender={readOnlyData.senderByMessageId.get(message.id)}",
  );
  code = replaceOnce(
    code,
    "  ), [readOnlyData.channels,",
    "  ), [loomFocusId, loomOnOpenProfile, readOnlyData.channels,",
  );
  code = replaceOnce(
    code,
    "        readOnlySender={readOnlyData.senderByMessageId.get(readOnlyData.parentMessage.id)}",
    "        onOpenProfile={loomOnOpenProfile}\n        readOnlySender={readOnlyData.senderByMessageId.get(readOnlyData.parentMessage.id)}",
  );
  code = replaceOnce(
    code,
    '          actions={presentation !== "mobile-modal" ? (',
    '          actions={<>{loomHeaderActions}{presentation !== "mobile-modal" ? (',
  );
  code = replaceOnce(
    code,
    "          ) : undefined}",
    "          ) : undefined}</>}",
  );
  return replaceOnce(
    code,
    "      </ThreadPanelBody>\n      </ThreadPanelContent>\n    </ThreadPanelRoot>",
    "      </ThreadPanelBody>\n      {loomFooter}\n      </ThreadPanelContent>\n    </ThreadPanelRoot>",
  );
}

/** Local send override follows Loom's Enter contract, including touch keyboards. */
export function adaptComposerSubmit(source: string) {
  return replaceOnce(
    source,
    'if (typeof window !== "undefined" &&\n        window.matchMedia("(pointer: coarse) and (orientation: portrait)").matches)',
    'if (!onSendOverride && typeof window !== "undefined" &&\n        window.matchMedia("(pointer: coarse) and (orientation: portrait)").matches)',
  );
}
