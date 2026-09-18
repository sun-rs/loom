export type SidebarDisclosure = Record<string, boolean>;
const key = (scope: string) => `rah:sidebar-disclosure:v1:${scope}`;

export function readSidebarDisclosure(
  storage: Storage | undefined,
  scope: string,
  instanceId: string,
): SidebarDisclosure {
  try {
    const saved = JSON.parse(storage?.getItem(key(scope)) ?? "null");
    if (
      saved?.instanceId !== instanceId ||
      !saved.choices ||
      Array.isArray(saved.choices) ||
      typeof saved.choices !== "object"
    )
      return {};
    return Object.fromEntries(
      Object.entries(saved.choices).filter(
        ([, value]) => typeof value === "boolean",
      ),
    ) as SidebarDisclosure;
  } catch {
    return {};
  }
}

export function writeSidebarDisclosure(
  storage: Storage | undefined,
  scope: string,
  instanceId: string,
  choices: SidebarDisclosure,
) {
  try {
    storage?.setItem(key(scope), JSON.stringify({ instanceId, choices }));
  } catch {
    /* Disclosure remains usable when browser storage is unavailable. */
  }
}
