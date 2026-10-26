import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { DialogFooter, Input } from "raft-ui";
import { DialogCommit } from "raft-ui/wip";
import MobileFormDialog from "../loom/MobileFormDialog";
afterEach(cleanup);
function media(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone && /max-width/.test(query),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}
function Form({ busy = false, onClose = () => {}, onSubmit = () => {} }) {
  return (
    <MobileFormDialog title="编辑测试" busy={busy} onClose={onClose}>
      <form
        id="test-mobile-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <Input aria-label="正文" defaultValue="草稿" />
        <DialogFooter>
          <DialogCommit type="submit" form="test-mobile-form" disabled={busy}>
            保存
          </DialogCommit>
        </DialogFooter>
      </form>
    </MobileFormDialog>
  );
}
test("phone sheet moves the same submit to its header and preserves form ownership", async () => {
  media(true);
  const submit = vi.fn();
  render(<Form onSubmit={submit} />);
  const dialog = await screen.findByRole("dialog");
  expect(dialog.hasAttribute("data-sheet")).toBe(true);
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "保存" })
        .closest('[data-slot="dialog-header"]'),
    ).not.toBeNull(),
  );
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(submit).toHaveBeenCalledTimes(1);
});
test("busy form cannot close or submit", async () => {
  media(true);
  const close = vi.fn(),
    submit = vi.fn();
  render(<Form busy onClose={close} onSubmit={submit} />);
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(close).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});
test("desktop remains a centered dialog with footer submit", async () => {
  media(false);
  render(<Form />);
  const dialog = await screen.findByRole("dialog");
  expect(dialog.hasAttribute("data-sheet")).toBe(false);
  expect(
    screen
      .getByRole("button", { name: "保存" })
      .closest('[data-slot="dialog-footer"]'),
  ).not.toBeNull();
});

test("official sheet follows the visual viewport while editing and restores after keyboard dismissal", async () => {
  media(true);
  const viewport = Object.assign(new EventTarget(), {
    height: 844,
    offsetTop: 0,
  });
  vi.stubGlobal("innerHeight", 844);
  vi.stubGlobal("visualViewport", viewport);
  render(<Form />);
  const dialog = await screen.findByRole("dialog");
  screen.getByRole("textbox", { name: "正文" }).focus();
  viewport.height = 480;
  fireEvent(viewport, new Event("resize"));
  await waitFor(() => expect(dialog.style.height).toBe("480px"));
  expect(dialog.style.top).toBe("0px");
  viewport.height = 844;
  fireEvent(viewport, new Event("resize"));
  await waitFor(() => expect(dialog.style.height).toBe(""));
});
