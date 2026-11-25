export function countNativeInputs(rows, id) {
  const marker = '[loom:' + id + ']';
  return rows.filter(({ type, payload }) => type === 'response_item' && payload?.type === 'message' &&
    payload.role === 'user' && payload.content?.some(part => part.type === 'input_text' &&
      typeof part.text === 'string' && part.text.trimStart().startsWith(marker))).length;
}

export function deliveryChecks({ id, body, inbox, native, provider, warmup = false }) {
  const accepted = provider.filter(row => row.delivery === id);
  const evidence = {
    inboxRecords: inbox.length,
    received: inbox.some(row => Boolean(row.received)),
    finalBody: inbox[0]?.completion?.body,
    expectedBody: body,
    nativeInputs: countNativeInputs(native, id),
    modelRequests: accepted.length,
    modelClosedBeforeRelease: accepted.some(row => Boolean(row.closedBeforeRelease)),
  };
  return { ...evidence, ok: evidence.inboxRecords === 1 && evidence.received && evidence.finalBody === body &&
    evidence.nativeInputs === 1 && (warmup ? evidence.modelRequests >= 1 : evidence.modelRequests === 1) && !evidence.modelClosedBeforeRelease };
}
