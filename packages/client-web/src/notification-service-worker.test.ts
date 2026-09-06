import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

type ClickEvent = {
  notification: { close: () => void; data?: { url?: string } };
  waitUntil: (value: Promise<unknown>) => void;
};

function loadNotificationClickHandler(clients: Record<string, unknown>) {
  let handler: ((event: ClickEvent) => void) | undefined;
  const source = readFileSync(
    new URL("../public/rah-notification-sw.js", import.meta.url),
    "utf8",
  );
  runInNewContext(source, {
    URL,
    clients,
    self: {
      location: { origin: "https://rah.local" },
      addEventListener(type: string, listener: (event: ClickEvent) => void) {
        if (type === "notificationclick") handler = listener;
      },
    },
  });
  assert.ok(handler, "notificationclick handler was not registered");
  return handler;
}

test("notification clicks focus and navigate an existing RAH window", async () => {
  const calls: string[] = [];
  const client = {
    url: "https://rah.local/?surface=room&roomId=old",
    async focus() {
      calls.push("focus");
    },
    async navigate(url: string) {
      calls.push(`navigate:${url}`);
    },
  };
  const handler = loadNotificationClickHandler({
    async matchAll() {
      return [client];
    },
  });
  let closed = false;
  let completion: Promise<unknown> | undefined;
  handler({
    notification: {
      data: { url: "/?surface=room&roomId=room-one&messageId=message-one" },
      close: () => {
        closed = true;
      },
    },
    waitUntil: (value) => {
      completion = value;
    },
  });
  await completion;
  assert.equal(closed, true);
  assert.deepEqual(calls, [
    "focus",
    "navigate:https://rah.local/?surface=room&roomId=room-one&messageId=message-one",
  ]);
});

test("notification clicks open the typed target when no RAH window exists", async () => {
  const opened: string[] = [];
  const handler = loadNotificationClickHandler({
    async matchAll() {
      return [];
    },
    async openWindow(url: string) {
      opened.push(url);
    },
  });
  let completion: Promise<unknown> | undefined;
  handler({
    notification: {
      data: { url: "/?surface=room&roomId=room-one&tab=tasks&taskId=task-one" },
      close: () => undefined,
    },
    waitUntil: (value) => {
      completion = value;
    },
  });
  await completion;
  assert.deepEqual(opened, [
    "https://rah.local/?surface=room&roomId=room-one&tab=tasks&taskId=task-one",
  ]);
});
