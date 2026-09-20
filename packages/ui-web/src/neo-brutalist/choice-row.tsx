import {
  useState,
  type ComponentPropsWithRef,
  type SyntheticEvent,
} from "react";

type Profile =
  | {
      profile: "member-selection";
      selection?: "check" | "tint";
      selected?: boolean;
      archived?: never;
      current?: never;
    }
  | {
      profile: "member-browse";
      selection?: never;
      selected?: never;
      archived?: never;
      current?: never;
    }
  | {
      profile: "property-option" | "autocomplete";
      selection?: never;
      selected?: never;
      archived?: never;
      current?: boolean;
    };
type Props = (
  | Profile
  | {
      profile: "channel-autocomplete";
      current?: boolean;
      selection?: never;
      selected?: never;
      archived?: boolean;
    }
) &
  (
    | ({ as?: "button"; clearHighlightOnDeselect?: boolean } & Omit<
        ComponentPropsWithRef<"button">,
        "style"
      >)
    | ({ as: "div"; clearHighlightOnDeselect?: never } & Omit<
        ComponentPropsWithRef<"div">,
        "style"
      >)
  );

/** Source-backed choice presentation. Callers own navigation, selection and checks.
 * No local styles: geometry classes are checked by the UI ownership gate. */
export function ChoiceRow({
  profile,
  selection,
  selected,
  current,
  archived,
  clearHighlightOnDeselect = false,
  className = "",
  ...props
}: Props) {
  const [highlightDismissed, setHighlightDismissed] = useState(false);
  const ariaDisabled =
    props["aria-disabled"] === true || props["aria-disabled"] === "true";
  const blockActivation = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const state = {
    className: `rah-choice-row ${className}`,
    "data-choice-profile": profile,
    "data-choice-archived": archived || undefined,
    "data-choice-current": current || undefined,
    "data-choice-highlight-dismissed":
      (clearHighlightOnDeselect && highlightDismissed && !current) || undefined,
    "data-choice-selected": (selected && selection === "tint") || undefined,
  };
  if (props.as === "div") {
    const { as: _as, ...rest } = props;
    return (
      <div
        {...rest}
        {...state}
        tabIndex={ariaDisabled ? -1 : rest.tabIndex}
        onClickCapture={ariaDisabled ? blockActivation : rest.onClickCapture}
        onKeyDownCapture={
          ariaDisabled ? blockActivation : rest.onKeyDownCapture
        }
      />
    );
  }
  const { as: _as, ...rest } = props;
  return (
    <button
      type="button"
      {...rest}
      {...state}
      disabled={rest.disabled || ariaDisabled}
      onClick={(event) => {
        rest.onClick?.(event);
        if (clearHighlightOnDeselect && !event.defaultPrevented)
          setHighlightDismissed(Boolean(current));
      }}
      onPointerEnter={(event) => {
        setHighlightDismissed(false);
        rest.onPointerEnter?.(event);
      }}
      onPointerLeave={(event) => {
        setHighlightDismissed(false);
        rest.onPointerLeave?.(event);
      }}
      onBlur={(event) => {
        setHighlightDismissed(false);
        rest.onBlur?.(event);
      }}
    />
  );
}
