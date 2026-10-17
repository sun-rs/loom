// One in-flight preview read for the app-level native preview surface.
// This owns cancellation only; the official store still owns the visible preview.
let active: AbortController | undefined;
export function beginAttachmentPreview() {
  active?.abort();
  active = new AbortController();
  return active;
}
export function cancelAttachmentPreview(request: AbortController | undefined) {
  request?.abort();
  if (active === request) active = undefined;
}
