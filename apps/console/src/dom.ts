/** DOM construction by createElement/textContent only; no HTML parsing. */
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: {
    attrs?: Record<string, string>;
    className?: string;
    text?: string;
  } = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props.className !== undefined) element.className = props.className;
  if (props.text !== undefined) element.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    element.setAttribute(name, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  }
  return element;
}

export function field(
  label: string,
  value: string,
  className = "",
): HTMLElement {
  return el("div", { className: `field ${className}`.trim() }, [
    el("span", { className: "field-label", text: label }),
    el("span", { className: "field-value", text: value }),
  ]);
}

export function localTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

/** Drops absent children so optional sections can be passed inline. */
export function present(...children: readonly Child[]): Array<Node | string> {
  return children.filter(
    (child): child is Node | string =>
      child !== null && child !== undefined && child !== false,
  );
}

export function button(
  text: string,
  onClick: () => void,
  props: { attrs?: Record<string, string>; className?: string } = {},
): HTMLButtonElement {
  const element = el("button", {
    attrs: { type: "button", ...props.attrs },
    className: props.className ?? "",
    text,
  });
  element.addEventListener("click", onClick);
  return element;
}

/** A labelled form control; the label wraps the control for accessibility. */
export function labelled(
  label: string,
  control: HTMLElement,
  hint?: string,
): HTMLElement {
  return el("label", { className: "form-row" }, [
    el("span", { className: "field-label", text: label }),
    control,
    hint === undefined
      ? null
      : el("span", { className: "muted hint", text: hint }),
  ]);
}

export function setOptions(
  select: HTMLSelectElement,
  options: ReadonlyArray<{ label: string; value: string }>,
  placeholder?: string,
): void {
  const previous = select.value;
  select.replaceChildren(
    ...(placeholder === undefined
      ? []
      : [el("option", { attrs: { value: "" }, text: placeholder })]),
    ...options.map(({ label, value }) =>
      el("option", { attrs: { value }, text: label }),
    ),
  );
  if ([...select.options].some((option) => option.value === previous)) {
    select.value = previous;
  }
}

/** Status line for an action: neutral, success or error, text only. */
export function setStatus(
  element: HTMLElement,
  tone: "info" | "ok" | "error",
  text: string,
): void {
  element.classList.remove("tone-info", "tone-ok", "tone-error");
  element.classList.add("action-status", `tone-${tone}`);
  element.textContent = text;
}
