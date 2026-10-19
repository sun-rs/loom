// Structural port of MessageSearchPage's load-more footer; original UI parameters.
import { useIntl } from "react-intl";
import { Button } from "raft-ui";
import Banner from "../packages/web/src/components/ui/Banner.tsx";
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
    <div className="flex flex-col items-center gap-2 px-4 py-4">
      {loadMoreError ? (
        <Banner
          intent="warning"
          role="alert"
          withIcon
          className="w-full"
          actions={
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
          }
        >
          {formatMessage({ id: "search.loadMoreFailed" })}
        </Banner>
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
