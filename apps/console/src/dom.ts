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
