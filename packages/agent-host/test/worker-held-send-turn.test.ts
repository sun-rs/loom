import assert from "node:assert/strict";
import test from "node:test";

import {
  workerHeldSendGuidance,
  workerTargetConfirmationBody,
  workerTargetConfirmationNextAction,
} from "../src/worker-held-send.ts";

/**
 * A warm runtime requires `--turn <handle>` on every Worker command. The
 * recovery commands a refused or held send prints must carry the same handle,
 * so `--send-draft` resends through the same turn credential; the Kernel keeps
 * the held send's based-on seq and `--final` with the draft itself.
 */
const held = {
  state: "held",
  heldDraftId: "held_draft_1",
  recoveryTarget: "#drift",
  newMessageCount: 1,
  newerMessages: [],
  continueAnywaySuggested: true,
};
const confirmation = {
  state: "target_confirmation_required",
  parentTarget: "#drift",
  threadTarget: "#drift:abcd1234",
};

test("hold guidance carries the invocation's --turn on every recovery command", () => {
  const text = workerHeldSendGuidance(held, " --turn t1")!;
  assert.match(
    text,
    /rah worker message-post --send-draft --turn t1 --target '#drift'\n/u,
  );
  assert.match(
    text,
    /rah worker message-post --send-draft --anyway --turn t1 --target '#drift'/u,
  );
  assert.match(text, /rah worker message-post --turn t1 --target '#drift' <</u);
  assert.doesNotMatch(workerHeldSendGuidance(held)!, /--turn/u);
});

test("thread-target confirmation carries the invocation's --turn", () => {
  const body = workerTargetConfirmationBody(confirmation, " --turn t1")!;
  assert.match(
    body,
    /rah worker message-post --send-draft --turn t1 --target '#drift'$/u,
  );
  assert.match(
    body,
    /rah worker message-post --turn t1 --target '#drift:abcd1234' <</u,
  );
  assert.match(
    workerTargetConfirmationNextAction(confirmation, " --turn t1")!,
    /message-post --send-draft --turn t1 --target '#drift'/u,
  );
  assert.doesNotMatch(workerTargetConfirmationBody(confirmation)!, /--turn/u);
});
