import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AvatarLibraryPicker from "../loom/AvatarLibraryPicker";
vi.mock("../packages/web/src/components/ui/AvatarSlot.tsx", () => ({
  default: () => <span />,
}));
vi.mock("../packages/web/src/components/ui/Tooltip.tsx", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
afterEach(cleanup);
test("avatar picker offers native file upload alongside all presets, with a separate random action", () => {
  const change = vi.fn(),
    upload = vi.fn(),
    random = vi.fn();
  render(
    <AvatarLibraryPicker
      value="pixel:robot"
      disabled={false}
      onChange={change}
      onUpload={upload}
      onRandom={random}
    />,
  );
  expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  const input = screen.getByTestId("avatar-upload-input");
  expect(input.getAttribute("accept")).toBe(
    "image/jpeg,image/png,image/gif,image/webp",
  );
  const file = new File(["fixture"], "avatar.png", { type: "image/png" });
  fireEvent.change(input, { target: { files: [file] } });
  expect(upload).toHaveBeenCalledWith(file);
  fireEvent.click(screen.getByRole("button", { name: "随机头像" }));
  expect(random).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "robot", exact: true }));
  expect(change).toHaveBeenCalledWith("pixel:robot");
});
