import { create } from "zustand";
export const defaultRailOrder = [
  "channels",
  "activity",
  "tasks",
  "agents",
  "computers",
  "memory",
];
export function normalizeRailOrder(value: unknown): string[] {
  return [
    ...new Set([...(Array.isArray(value) ? value : []), ...defaultRailOrder]),
  ].filter((id) => defaultRailOrder.includes(id));
}
const key = "loom:device:rail-order";
function readOrder() {
  try {
    return normalizeRailOrder(JSON.parse(localStorage.getItem(key) ?? "null"));
  } catch {
    return [...defaultRailOrder];
  }
}
/** Device presentation only. No Room state or upstream account store. */
export const useNavigationPreferences = create<{
  user: { railTabOrder: string[] };
  updateRailTabOrder: (order: string[]) => void;
}>((set) => ({
  user: { railTabOrder: readOrder() },
  updateRailTabOrder: (order) => {
    const next = normalizeRailOrder(order);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Storage-denied devices retain this tab's preference. */
    }
    set({ user: { railTabOrder: next } });
  },
}));

import { useIntl } from "react-intl";
// Chinese labels for newly published keys absent from the pinned Git locale.
const navigationMessages: Record<string, string> = {
  "layout.leftRail.dragInstructions":
    "按空格键拿起标签，方向键移动，空格键放下，Escape 取消。按 Enter 打开。",
  "layout.leftRail.dragPickedUp": "已拿起{name}。",
  "layout.leftRail.dragOver": "{name}位于{target}上方。",
  "layout.leftRail.dragNotOver": "{name}已离开标签区域。",
  "layout.leftRail.dragDroppedAt": "已将{name}放在{target}的位置。",
  "layout.leftRail.dragDropped": "已放下{name}。",
  "layout.leftRail.dragCancelled": "已取消移动{name}。",
};
export function useNavigationIntl() {
  const intl = useIntl();
  return {
    formatMessage: (
      descriptor: { id: string },
      values?: Record<string, string>,
    ) =>
      intl.formatMessage(
        { ...descriptor, defaultMessage: navigationMessages[descriptor.id] },
        values,
      ),
  };
}
