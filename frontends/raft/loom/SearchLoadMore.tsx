// Structural port of MessageSearchPage's load-more footer; original UI parameters.
import { useIntl } from "react-intl";
import { Button } from "raft-ui";
export default function SearchLoadMore({
  loadingMore,
  loadMoreError,
  loadMoreResults,
}: {
  loadingMore: boolean;
  loadMoreError: boolean;
  loadMoreResults: () => void;
}) {
  const { formatMessage } = useIntl();
  return (
    <div className="flex justify-center py-4">
      {loadMoreError ? (
        <div
          role="alert"
          className="flex items-center gap-3 border border-line-muted bg-layer-card px-3 py-2 shadow-raft-sm    "
        >
          <span className="text-xs font-bold text-foreground-strong ">
            {formatMessage({ id: "search.loadMoreFailed" })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadMoreResults}
            disabled={loadingMore}
          >
            {loadingMore
              ? formatMessage({ id: "common.loading" })
              : formatMessage({ id: "search.retry" })}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={loadMoreResults}
          disabled={loadingMore}
        >
          {loadingMore
            ? formatMessage({ id: "common.loading" })
            : formatMessage({ id: "search.loadMore" })}
        </Button>
      )}
    </div>
  );
}
