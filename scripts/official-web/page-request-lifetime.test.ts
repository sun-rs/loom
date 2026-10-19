import assert from "node:assert/strict";
import test from "node:test";
import { observePageRequestLifetime } from "../../frontends/raft/loom/page-request-lifetime.ts";
test("pagehide aborts reads; only persisted restoration requests a fresh lifetime", () => {
  const target = new EventTarget(),
    controller = new AbortController();
  let resumes = 0;
  const dispose = observePageRequestLifetime(
    target,
    controller,
    () => resumes++,
  );
  target.dispatchEvent(new Event("pageshow"));
  assert.equal(resumes, 0);
  target.dispatchEvent(new Event("pagehide"));
  assert.equal(controller.signal.aborted, true);
  target.dispatchEvent(new Event("pageshow"));
  assert.equal(resumes, 0);
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  target.dispatchEvent(event);
  assert.equal(resumes, 1);
  dispose();
  target.dispatchEvent(event);
  assert.equal(resumes, 1);
});

test("beforeunload stops reads early unless the write owner may cancel leaving", () => {
  const target = new EventTarget();
  const controller = new AbortController();
  let mayLeave = false;
  const dispose = observePageRequestLifetime(
    target,
    controller,
    () => {},
    () => mayLeave,
  );
  target.dispatchEvent(new Event("beforeunload"));
  assert.equal(controller.signal.aborted, false);
  mayLeave = true;
  target.dispatchEvent(new Event("beforeunload"));
  assert.equal(controller.signal.aborted, true);
  dispose();
});
