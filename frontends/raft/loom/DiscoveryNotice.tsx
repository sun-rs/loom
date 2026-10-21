import type { ReactNode } from "react";
import Banner from "@loom/raft-web-source/Banner";
/** Official search warning scenario; Loom retains the actual query/open/action cause and retry. */
export default function DiscoveryNotice({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Banner
      intent="warning"
      role="alert"
      withIcon
      className="mx-4"
      actions={actions}
    >
      {children}
    </Banner>
  );
}
