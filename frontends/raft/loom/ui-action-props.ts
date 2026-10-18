// Native parameter bindings only, not a Button wrapper or a second style system.
// Sources/scenarios: ui-contract.json actionBindings. raft-ui owns all recipes.
import type { ButtonProps } from "raft-ui";
type ActionBinding = Pick<ButtonProps, "size" | "variant"> & {
  "data-loom-action": string;
};
export const uiActionProps = {
  formSave: { size: "md", variant: "accent", "data-loom-action": "formSave" },
  formCancel: {
    size: "md",
    variant: "outline",
    "data-loom-action": "formCancel",
  },
  dialogSave: {
    size: "sm",
    variant: "accent",
    "data-loom-action": "dialogSave",
  },
  confirmDelete: {
    size: "sm",
    variant: "danger",
    "data-loom-action": "confirmDelete",
  },
  confirmChange: {
    size: "sm",
    variant: "warning",
    "data-loom-action": "confirmChange",
  },
  recovery: { size: "sm", variant: "outline", "data-loom-action": "recovery" },
  secondary: {
    size: "sm",
    variant: "outline",
    "data-loom-action": "secondary",
  },
  menuIcon: {
    size: "icon-sm",
    variant: "ghost",
    "data-loom-action": "menuIcon",
  },
  panelIcon: {
    size: "icon-sm",
    variant: "outline",
    "data-loom-action": "panelIcon",
  },
} as const satisfies Record<string, ActionBinding>;
