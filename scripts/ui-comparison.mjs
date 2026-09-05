export const comparedProperties = {
  header: [
    "height",
    "paddingLeft",
    "paddingRight",
    "columnGap",
    "borderBottomWidth",
  ],
  action: [
    "width",
    "height",
    "borderTopWidth",
    "backgroundColor",
    "color",
    "fontSize",
    "boxShadow",
    "transform",
  ],
  icon: ["width", "height", "strokeWidth"],
  tab: [
    "height",
    "paddingLeft",
    "paddingRight",
    "columnGap",
    "fontSize",
    "fontWeight",
    "lineHeight",
  ],
  keyboard: ["selected", "focused"],
  tile: ["width", "height", "borderTopWidth", "boxShadow"],
  tileIcon: ["width", "height", "strokeWidth"],
  heading: ["fontSize", "fontWeight", "lineHeight"],
};

export const pairs = [
  { id: "header", component: "panel-header", behavior: "UI003" },
  { id: "action", component: "panel-header-action", behavior: "UI002" },
  { id: "icon", component: "icon", behavior: "UI002" },
  { id: "tab", component: "panel-tabs", behavior: "UI004" },
  { id: "keyboard", component: "panel-tabs", behavior: "UI004" },
  { id: "tile", component: "panel-header-icon", behavior: "UI003" },
  { id: "tileIcon", component: "panel-header-icon", behavior: "UI003" },
  { id: "heading", component: "panel-header", behavior: "UI003" },
].map((p) => ({ ...p, properties: comparedProperties[p.id] }));

export function validateComparisonPlan(plan, official, library) {
  const errors = [],
    seen = new Set();
  if (
    plan.schemaVersion !== 1 ||
    official.schemaVersion !== 1 ||
    official.kind !== "official-live-capture"
  )
    errors.push("unsupported evidence kind/schema");
  if (!Array.isArray(plan.scenarios) || plan.scenarios.length === 0)
    errors.push("comparison plan requires at least one scenario");
  for (const pair of pairs) {
    const component = library.components.find((c) => c.id === pair.component);
    if (!component?.behaviors.includes(pair.behavior))
      errors.push(`misbound behavior: ${pair.component}/${pair.behavior}`);
  }
  for (const scenario of plan.scenarios) {
    if (
      scenario.route !== undefined &&
      !["room", "settings-notifications"].includes(scenario.route)
    )
      errors.push(`unsupported read-only route: ${scenario.route}`);
    if (seen.has(scenario.id))
      errors.push(`duplicate scenario: ${scenario.id}`);
    seen.add(scenario.id);
    if (official.samples.filter((s) => s.id === scenario.id).length !== 1)
      errors.push(`missing/ambiguous official sample: ${scenario.id}`);
    if (
      !scenario.pairs.length ||
      scenario.pairs.some((id) => !pairs.some((p) => p.id === id))
    )
      errors.push(`unknown pairing: ${scenario.id}`);
    if (
      scenario.keys.some(
        (k) =>
          ![
            "Home",
            "End",
            "Enter",
            "Space",
            "ArrowLeft",
            "ArrowRight",
          ].includes(k),
      )
    )
      errors.push(`unsupported key: ${scenario.id}`);
  }
  return errors;
}

function normalize(value) {
  if (typeof value !== "string") return value;
  return value
    .replaceAll("oklch(0 0 0)", "rgb(0, 0, 0)")
    .replaceAll("oklch(1 0 0)", "rgb(255, 255, 255)")
    .replaceAll("rgba(0, 0, 0, 0) 0px 0px 0px 0px, ", "");
}

export function compareSample(pair, official, local) {
  const sameEnvironment =
    official?.environment?.fonts === "loaded" &&
    ["width", "height", "dpr", "fonts", "enabledTabs"].every(
      (k) =>
        official?.environment?.[k] !== undefined &&
        JSON.stringify(official.environment[k]) ===
          JSON.stringify(local?.environment?.[k]),
    );
  return pair.properties.map((property) => {
    const a = official?.observations?.[pair.id]?.[property];
    const b = local?.observations?.[pair.id]?.[property];
    const exception = pair.exceptions?.[property];
    const status =
      !sameEnvironment || a == null || b == null
        ? "uncomparable"
        : normalize(a) === normalize(b)
          ? "matched"
          : exception?.reason &&
              a === exception.official &&
              b === exception.local
            ? "approved-local-difference"
            : "different";
    return {
      component: pair.component,
      behavior: pair.behavior,
      property,
      status,
      official: a ?? null,
      local: b ?? null,
      ...(status === "uncomparable"
        ? {
            reason: sameEnvironment
              ? "missing observation"
              : "prerequisites differ or are missing",
          }
        : {}),
      ...(status === "approved-local-difference"
        ? { reason: exception.reason }
        : {}),
    };
  });
}

// Pure read-only DOM collector used against production compositions, not copies.
export function captureComponents({ selectors, properties }) {
  const observations = {};
  for (const [id, selector] of Object.entries(selectors)) {
    const matches = document.querySelectorAll(selector);
    if (matches.length !== 1) {
      observations[id] = null;
      continue;
    }
    const element = matches[0],
      style = getComputedStyle(element);
    observations[id] = Object.fromEntries(
      properties[id].map((p) => [p, style[p]]),
    );
  }
  const list = document.querySelector('[aria-label="对话内容"]');
  observations.keyboard = {
    selected:
      list?.querySelector('[aria-selected="true"]')?.textContent.trim() ?? null,
    focused:
      list?.contains(document.activeElement) &&
      document.activeElement?.getAttribute("role") === "tab"
        ? document.activeElement.textContent.trim()
        : null,
  };
  return {
    environment: {
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      fonts: document.fonts.status,
      enabledTabs: list
        ? [...list.querySelectorAll('[role="tab"]')]
            .filter(
              (e) =>
                !e.hasAttribute("disabled") &&
                e.getAttribute("aria-disabled") !== "true",
            )
            .map((e) => e.textContent.trim())
        : null,
    },
    observations,
  };
}
