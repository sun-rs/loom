import { useEffect, useRef, useState, type Ref } from "react";
import { useIntl } from "react-intl";
import { OfficialSearchHeader } from "./OfficialSearchControls.generated";
import {
  getCommittedSearchQuery,
  isSearchKeyboardComposing,
} from "../packages/web/src/components/search/searchComposition.ts";

/** Loom query/IME controller. Rendering is extracted from locked MessageSearchPage. */
export function useSearchHeaderController({
  inputRef,
  query,
  onQuery,
  onBack,
  onEscape,
  overlay = false,
}: {
  inputRef?: Ref<HTMLInputElement>;
  overlay?: boolean;
  query: string;
  onQuery: (query: string) => void;
  onBack: () => void;
  onEscape: () => void;
}) {
  const { formatMessage } = useIntl();
  const [input, setInput] = useState(query);
  const composing = useRef(false);
  useEffect(() => setInput(query), [query]);
  const change = (value: string) => {
    setInput(value);
    const committed = getCommittedSearchQuery(value, composing.current);
    if (committed !== null) onQuery(committed);
  };
  return {
    inputRef,
    query: input,
    overlayChrome: overlay,
    handleBack: onBack,
    mobileBackProps: { "aria-label": "返回聊天列表" },
    searchPlaceholder: overlay
      ? formatMessage({ id: "search.overlay.placeholder" })
      : formatMessage({ id: "search.placeholder" }, { shortcutHint: "" }),
    handleQueryChange: (event: import("react").ChangeEvent<HTMLInputElement>) =>
      change(event.target.value),
    handleQueryCompositionStart: () => {
      composing.current = true;
    },
    handleQueryCompositionEnd: (
      event: import("react").CompositionEvent<HTMLInputElement>,
    ) => {
      composing.current = false;
      change(event.currentTarget.value);
    },
    handleKeyDown: (event: import("react").KeyboardEvent<HTMLInputElement>) => {
      if (isSearchKeyboardComposing(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
      }
    },
    clearQuery: () => change(""),
  };
}
export default function SearchHeader(
  props: Parameters<typeof useSearchHeaderController>[0],
) {
  return <OfficialSearchHeader {...useSearchHeaderController(props)} />;
}
