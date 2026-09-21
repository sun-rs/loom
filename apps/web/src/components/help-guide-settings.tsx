import { LoadingState } from "@rah-os/ui-web/neo-brutalist/loading-state";
import { useEffect, useState } from "react";
import { SettingsPage } from "./settings-primitives.tsx";

/** The shipped same-origin guide remains the single content source. */
export function HelpGuideSettings() {
  const [html, setHtml] = useState<string>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void fetch("/help/local-workbench.html", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Guide unavailable");
        const document = new DOMParser().parseFromString(
          await response.text(),
          "text/html",
        );
        const main = document.querySelector("main");
        if (!main) throw new Error("Guide content missing");
        main.querySelector("h1")?.remove();
        if (!controller.signal.aborted) setHtml(main.innerHTML);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [attempt]);
  return (
    <SettingsPage icon="book-open" title="帮助">
      {html !== undefined ? (
        <article
          className="rah-settings-guide"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : error ? (
        <div role="alert">
          操作指南加载失败。
          <button
            className="btn"
            onClick={() => setAttempt((value) => value + 1)}
          >
            重试
          </button>
        </div>
      ) : (
        <LoadingState />
      )}
    </SettingsPage>
  );
}
