// Provider response accounting for a serial OpenCode benchmark arm. Pure: no
// provider calls. Primary totals and optional breakdowns have separate coverage.
// The caller supplies all captured requests and native assistant records in the
// same order; this module cannot discover uncaptured requests or invoice charges.
// `complete` additionally rejects malformed supplied details; missing details do
// not invalidate primary totals. Known values on an incomplete stream are partial.
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const identity = (v) =>
  (typeof v === "string" && v.trim().length > 0) || count(v);
const fields = {
  input: (u) => u?.prompt_tokens,
  output: (u) => u?.completion_tokens,
  cachedInput: (u) => u?.prompt_tokens_details?.cached_tokens,
  reasoningOutput: (u) => u?.completion_tokens_details?.reasoning_tokens,
};
const stream = (r) =>
  r.status === 200 &&
  r.complete === true &&
  r.done === true &&
  !r.captureLimitExceeded &&
  !r.sseParseErrors &&
  !r.contentEncoding;
export function reconcileAll(requests, messages) {
  let identityValid = true,
    totalsConsistent = true;
  const dimensionInvalid = new Set();
  const errors = [],
    unique = new Map(),
    conflicts = new Set();
  for (const r of requests) {
    if (!identity(r.id)) {
      identityValid = false;
      errors.push("invalid upstream identity");
    }
    const old = unique.get(r.id);
    if (old) {
      identityValid = false;
      errors.push("duplicate upstream identity");
      if (
        JSON.stringify(old.usage) !== JSON.stringify(r.usage) ||
        stream(old) !== stream(r)
      )
        conflicts.add(r.id);
    } else unique.set(r.id, r);
  }
  const rows = [...unique.values()],
    dimensions = Object.fromEntries(
      Object.keys(fields).map((k) => [
        k,
        { known: 0, knownRequests: 0, unknownRequests: 0 },
      ]),
    );
  for (const r of rows) {
    const u = r.usage;
    for (const [k, get] of Object.entries(fields)) {
      const v = get(u),
        bound =
          k === "cachedInput"
            ? u?.prompt_tokens
            : k === "reasoningOutput"
              ? u?.completion_tokens
              : undefined;
      const valid =
        count(v) &&
        (bound === undefined || (count(bound) && v <= bound)) &&
        !conflicts.has(r.id);
      if (valid) {
        dimensions[k].known += v;
        dimensions[k].knownRequests++;
      } else {
        dimensions[k].unknownRequests++;
        if (v !== undefined) errors.push(`invalid ${k} at ${r.id}`);
      }
    }
    if (
      u?.total_tokens !== undefined &&
      (!count(u.total_tokens) ||
        (count(u.prompt_tokens) &&
          count(u.completion_tokens) &&
          u.total_tokens !== u.prompt_tokens + u.completion_tokens))
    ) {
      totalsConsistent = false;
      errors.push("inconsistent total at " + r.id);
    }
  }
  if (messages.some((r) => !identity(r.id))) {
    identityValid = false;
    errors.push("invalid native identity");
  }
  if (new Set(messages.map((r) => r.id)).size !== messages.length) {
    identityValid = false;
    errors.push("duplicate native identity");
  }
  if (rows.length !== messages.length) {
    identityValid = false;
    errors.push("request/native coverage differs");
  }
  for (let i = 0; i < Math.min(rows.length, messages.length); i++) {
    const t = messages[i].tokens;
    const sum = (values) =>
      values.every(count) ? values.reduce((a, b) => a + b, 0) : undefined;
    const values = {
      input: sum([t?.input, t?.cache?.read, t?.cache?.write]),
      output: sum([t?.output, t?.reasoning]),
      cachedInput: t?.cache?.read,
      reasoningOutput: t?.reasoning,
    };
    for (const [field, get] of Object.entries(fields)) {
      const expected = get(rows[i].usage),
        observed = values[field];
      if (!count(observed) || (count(expected) && observed !== expected)) {
        dimensionInvalid.add(field);
        errors.push("native " + field + " usage mismatch at " + i);
      }
    }
  }
  const streamCoverageComplete = rows.every(stream),
    unknownRequests = rows.filter(
      (r) =>
        !stream(r) ||
        conflicts.has(r.id) ||
        !count(r.usage?.prompt_tokens) ||
        !count(r.usage?.completion_tokens),
    ).length;
  if (!rows.length) errors.push("no observed requests");
  const requestCoverageComplete =
    rows.length > 0 && streamCoverageComplete && identityValid;
  for (const [field, dimension] of Object.entries(dimensions)) {
    const safe = count(dimension.known);
    if (!safe) errors.push("unsafe aggregate " + field);
    dimension.complete =
      rows.length > 0 &&
      dimension.unknownRequests === 0 &&
      safe &&
      !dimensionInvalid.has(field) &&
      ((field !== "input" && field !== "output") || totalsConsistent);
  }
  const primaryComplete =
    requestCoverageComplete &&
    dimensions.input.complete &&
    dimensions.output.complete;
  const detailsComplete =
    primaryComplete &&
    dimensions.cachedInput.complete &&
    dimensions.reasoningOutput.complete &&
    errors.length === 0;
  return {
    identityCoverageComplete: rows.length > 0 && identityValid,
    requestCoverageComplete,
    primaryComplete,
    detailsComplete,
    requests: requests.length,
    uniqueRequests: rows.length,
    assistants: messages.length,
    input: dimensions.input.known,
    output: dimensions.output.known,
    cachedInput: dimensions.cachedInput.unknownRequests
      ? null
      : dimensions.cachedInput.known,
    reasoningOutput: dimensions.reasoningOutput.unknownRequests
      ? null
      : dimensions.reasoningOutput.known,
    unknownRequests,
    dimensions,
    streamCoverageComplete,
    complete: primaryComplete && errors.length === 0,
    errors,
    label:
      "complete refers to primary input/output and request/native coverage; optional detail completeness is reported independently; observed usage on incomplete streams is partial, not a final total",
  };
}
