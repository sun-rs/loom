import type { KeyboardEvent } from "react";

/** Shared Room/DM/Thread rule. Delegates to the existing form, never sends a second command. */
export function handleComposerKeyDown(
  event: KeyboardEvent<HTMLTextAreaElement>,
): void {
  if (
    event.defaultPrevented ||
    event.key !== "Enter" ||
    event.shiftKey ||
    event.nativeEvent.isComposing ||
    event.nativeEvent.keyCode === 229
  )
    return;
  event.preventDefault();
  if (event.repeat) return;
  const form = event.currentTarget.form;
  const button = form?.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  // The same disabled state covers permission, Task validation, upload and pending delivery.
  if (form && button && !button.disabled) form.requestSubmit(button);
}
