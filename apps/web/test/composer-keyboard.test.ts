import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { handleComposerKeyDown } from "../src/composer-keyboard.ts";

function press(
  options: {
    key?: string;
    shiftKey?: boolean;
    repeat?: boolean;
    isComposing?: boolean;
    keyCode?: number;
    disabled?: boolean;
    defaultPrevented?: boolean;
  } = {},
) {
  let prevented = false;
  let submissions = 0;
  const button = { disabled: options.disabled ?? false };
  const event = {
    key: options.key ?? "Enter",
    shiftKey: options.shiftKey ?? false,
    repeat: options.repeat ?? false,
    defaultPrevented: options.defaultPrevented ?? false,
    nativeEvent: {
      isComposing: options.isComposing ?? false,
      keyCode: options.keyCode ?? 13,
    },
    currentTarget: {
      form: {
        querySelector(selector: string) {
          assert.equal(selector, 'button[type="submit"]');
          return button;
        },
        requestSubmit(submitter: unknown) {
          assert.equal(submitter, button);
          submissions++;
        },
      },
    },
    preventDefault() {
      prevented = true;
    },
  };
  handleComposerKeyDown(
    event as unknown as Parameters<typeof handleComposerKeyDown>[0],
  );
  return { prevented, submissions };
}
test("Enter submits through the same enabled form button; Shift+Enter leaves native newline", () => {
  assert.deepEqual(press(), { prevented: true, submissions: 1 });
  assert.deepEqual(press({ shiftKey: true }), {
    prevented: false,
    submissions: 0,
  });
  assert.deepEqual(press({ key: "a" }), { prevented: false, submissions: 0 });
});
test("IME confirmation and consumed mention selection never send; repeated Enter never resubmits", () => {
  for (const options of [
    { isComposing: true },
    { keyCode: 229 },
    { defaultPrevented: true },
  ])
    assert.deepEqual(press(options), { prevented: false, submissions: 0 });
  assert.deepEqual(press({ repeat: true }), {
    prevented: true,
    submissions: 0,
  });
});
test("keyboard cannot bypass disabled Send (empty, pending, permission, invalid Task or uploading)", () => {
  assert.deepEqual(press({ disabled: true }), {
    prevented: true,
    submissions: 0,
  });
});
test("Room/DM and Thread composers share one Enter implementation and explicit submit buttons", () => {
  const source = readFileSync(
    new URL("../src/components/conversation-panes.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(source.match(/handleComposerKeyDown\(event\)/g)?.length, 2);
  assert.equal(source.match(/type="submit"/g)?.length, 2);
});
