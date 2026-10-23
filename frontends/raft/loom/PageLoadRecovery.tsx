import { IntlProvider, useIntl } from "react-intl";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppRefreshRequiredScreen } from "../packages/web/src/components/errors/AppUpdateGate.tsx";
import ConfirmDialog from "./OfficialConfirmation.generated.tsx";
import { hasRouteBoundIntent } from "./useIntentRoute.ts";
import { requestPageReload } from "./page-recovery.ts";

/** Official recovery presentation; Loom owns routing and unresolved-write guards.
 * This lives inside DemandPage, so ChannelApp/draft/write owners stay mounted.
 * Never clear browser storage, unsubscribe workers or replay a business request.
 */
export default function PageLoadRecovery({ error }: { error: unknown }) {
  const intl = useIntl();
  const [, setParams] = useSearchParams();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <IntlProvider
        locale={intl.locale}
        messages={{
          ...intl.messages,
          "app.update.refreshToContinue": "刷新 Loom 以继续",
        }}
      >
        <AppRefreshRequiredScreen
          onContinueAnyway={() =>
            setParams((previous) => {
              const next = new URLSearchParams(previous);
              next.delete("view");
              return next;
            })
          }
          onRecoverAndRefresh={() => setConfirm(true)}
        />
      </IntlProvider>
      {confirm && (
        <ConfirmDialog
          layer={1}
          title="刷新页面"
          message="刷新将重新加载界面，未保存的编辑可能丢失。可以取消并先返回保存；发送结果未确认时请先核实，刷新不会重新提交。"
          confirmLabel="确认刷新"
          confirmVariant="accent"
          closeOnConfirm={false}
          onClose={() => setConfirm(false)}
          onConfirm={() => {
            if (
              !requestPageReload(hasRouteBoundIntent, () =>
                window.location.reload(),
              )
            )
              throw new Error(
                "仍有进行中或结果未确认的操作，请先返回核实后再刷新。",
              );
          }}
        />
      )}
    </>
  );
}
