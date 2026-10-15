import { useEffect, useRef, useState } from "react";
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
  query,
  onQuery,
  onBack,
  onEscape,
}: {
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
  return (
    <PanelHeader
      onMobileBack={onBack}
      mobileBackProps={{ "aria-label": "返回聊天列表" }}
      titleSlot={
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex size-icon-header shrink-0 items-center justify-center border border-line-muted bg-primary-soft text-foreground-strong theme-brutal:border-2 theme-brutal:border-black theme-brutal:bg-soft-signal theme-brutal:text-black">
            <Search size={18} />
          </div>
          <InputGroup className="min-w-0 flex-1">
            <InputGroupInput
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
              placeholder={formatMessage(
                { id: "search.placeholder" },
                { shortcutHint: "" },
              )}
              aria-label="搜索内容"
              maxLength={300}
            />
            <InputGroupAddon align="inline-end">
              {input ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => change("")}
                  aria-label={formatMessage({ id: "search.clearSearch" })}
                >
                  <X aria-hidden size={12} />
                </Button>
              ) : null}
              <Kbd className="hidden sm:inline text-[10px] font-bold uppercase text-foreground-muted">
                Esc
              </Kbd>
            </InputGroupAddon>
          </InputGroup>
        </div>
      }
    />
  );
}
