import { useEffect, useRef, useState, type Ref } from "react";
import { useIntl } from "react-intl";
import {
  Button,
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  Kbd,
} from "raft-ui";
import { Search, X } from "lucide-react";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader.tsx";
import {
  getCommittedSearchQuery,
  isSearchKeyboardComposing,
} from "../packages/web/src/components/search/searchComposition.ts";

/** Structural port: MessageSearchPage searchFieldInner + full-page PanelHeader.
 * Original component classes/parameters; only URL and query callbacks belong to Loom. */
export default function SearchHeader({
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
  const field = (
    <InputGroup className="min-w-0 flex-1">
      <InputGroupAddon align="inline-start">
        <Search aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        autoFocus={overlay}
        value={input}
        onChange={(e) => change(e.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(e) => {
          composing.current = false;
          change(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (isSearchKeyboardComposing(e)) return;
          if (e.key === "Escape") {
            e.preventDefault();
            onEscape();
          }
        }}
        placeholder={
          overlay
            ? formatMessage({ id: "search.overlay.placeholder" })
            : formatMessage({ id: "search.placeholder" }, { shortcutHint: "" })
        }
        aria-label="搜索内容"
        maxLength={300}
      />
      <InputGroupAddon align="inline-end">
        {input ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => change("")}
            aria-label={formatMessage({ id: "search.clearSearch" })}
          >
            <X aria-hidden size={18} />
          </Button>
        ) : null}
        <Kbd className="hidden sm:inline-flex">Esc</Kbd>
      </InputGroupAddon>
    </InputGroup>
  );
  if (overlay)
    return (
      <div className="flex shrink-0 items-center border-b border-line-seam px-3 py-3">
        {field}
      </div>
    );
  return (
    <PanelHeader
      onMobileBack={onBack}
      mobileBackProps={{ "aria-label": "返回聊天列表" }}
      titleSlot={
        <div className="flex min-w-0 flex-1 items-center">{field}</div>
      }
    />
  );
}
