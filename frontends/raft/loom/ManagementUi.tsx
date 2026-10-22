import { useRouteIntentOwner } from "./useIntentRoute.ts";
import { uiActionProps } from "./ui-action-props.ts";
import { useEffect, useState, type ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectList,
  SelectValue,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogBody,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "raft-ui";
import { MoreHorizontal } from "lucide-react";
import StableField, {
  FieldSelectTrigger,
} from "../packages/web/src/components/agent/StableField.tsx";
import FormField from "../packages/web/src/components/ui/FormField.tsx";
import type { ManagementClient } from "./management-client.ts";
export function useManagement(manager: ManagementClient) {
  useRouteIntentOwner(manager.writes);
  const [state, setState] = useState(manager.writes.state);
  const [error, setError] = useState("");
  useEffect(() => {
    const stop = manager.writes.onChange(setState);
    return () => {
      stop();
      manager.writes.discard();
    };
  }, [manager]);
  return { state, error, setError };
}
export function ActionMenu({
  label,
  disabled,
  items,
}: {
  label: string;
  disabled?: boolean;
  items: {
    label: string;
    run: () => void;
    disabled?: boolean;
    icon?: ReactNode;
  }[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            {...uiActionProps.menuIcon}
            aria-label={label}
            disabled={disabled}
          />
        }
      >
        <MoreHorizontal size={16} />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {items.map((item, index) => (
          <DropdownMenuItem
            key={index}
            disabled={item.disabled}
            onClick={item.run}
          >
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function ActionDialog({
  title,
  manager,
  error,
  onClose,
  children,
}: {
  title: string;
  manager: ManagementClient;
  error: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && manager.writes.state === "idle") onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogClose
            aria-label="关闭操作"
            disabled={manager.writes.state !== "idle"}
          />
        </DialogHeader>
        <DialogBody>
          {children}
          <OperationStatus manager={manager} error={error} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
export function OperationStatus({
  manager,
  error,
}: {
  manager: ManagementClient;
  error: string;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="mt-3 text-sm whitespace-pre-wrap">
          {error}
        </p>
      )}
      {manager.writes.state === "pending" && <p role="status">正在处理…</p>}
      {manager.writes.state === "unknown" && (
        <div role="alert" className="mt-3">
          结果未知，核实前暂停其他操作。
          <Button
            {...uiActionProps.recovery}
            onClick={() => void manager.writes.retry()}
          >
            核实操作结果
          </Button>
        </div>
      )}
    </>
  );
}
export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled = false,
  portalContainer,
  stable = false,
}: {
  stable?: boolean;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  portalContainer?: React.RefObject<HTMLElement | null>;
  disabled?: boolean;
}) {
  const unavailable =
    Boolean(value) && !options.some((option) => option.value === value);
  const Field = stable ? StableField : FormField;
  return (
    <Field label={label} className={stable ? undefined : "mb-3"}>
      <Select
        chrome="field"
        value={unavailable ? null : value || null}
        items={options}
        onValueChange={(next) => onChange(next ?? "")}
        disabled={disabled}
      >
        <FieldSelectTrigger
          aria-label={label}
          className="loom-field-select w-full"
        >
          <SelectValue
            placeholder={unavailable ? "当前配置不可用" : "请选择"}
          />
          <SelectIcon />
        </FieldSelectTrigger>
        <SelectContent
          portalProps={
            portalContainer ? { container: portalContainer } : undefined
          }
        >
          <SelectList>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <SelectItemText>{option.label}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectList>
        </SelectContent>
      </Select>
    </Field>
  );
}
