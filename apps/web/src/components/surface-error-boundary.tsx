import { Component, type ErrorInfo, type ReactNode } from "react";

import {
  boundaryStateForProps,
  boundaryStateFromError,
  SURFACE_RECOVERY_RELOAD_LABEL,
  SURFACE_RECOVERY_RETRY_LABEL,
  sanitizeSurfaceDiagnostic,
  type SurfaceBoundaryState,
} from "./surface-error-boundary-diagnostic.ts";

type SurfaceErrorBoundaryProps = {
  /** Human-readable surface name shown in the recovery panel. */
  surface: string;
  /** Changing this prop clears the failure; the boundary owns no other state. */
  resetKey?: string | undefined;
  children: ReactNode;
};

/** One shared render-failure owner. It renders children transparently, so shell
 *  layout selectors that depend on direct children keep working, and on a render
 *  throw it replaces only its own subtree with a recoverable, sanitized panel.
 *  It never holds message, draft, selection or read-position state: recovery is
 *  a re-render of the same parent-owned data, not a second store. */
export class SurfaceErrorBoundary extends Component<
  SurfaceErrorBoundaryProps,
  SurfaceBoundaryState
> {
  constructor(props: SurfaceErrorBoundaryProps) {
    super(props);
    this.state = { diagnostic: undefined, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: unknown): SurfaceBoundaryState {
    return boundaryStateFromError(error);
  }

  static getDerivedStateFromProps(
    props: SurfaceErrorBoundaryProps,
    state: SurfaceBoundaryState,
  ): SurfaceBoundaryState | null {
    return boundaryStateForProps(state, props.resetKey);
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Diagnostics only: the durable ledger is untouched and no backend restarts.
    console.error(
      `[rah] ${this.props.surface} 渲染失败 ${sanitizeSurfaceDiagnostic(error)}`,
      { componentStack: info.componentStack?.slice(0, 2000) },
    );
  }

  override render(): ReactNode {
    const { diagnostic } = this.state;
    if (diagnostic === undefined) return this.props.children;
    return (
      <div
        role="alert"
        className="rah-surface-recovery"
        data-surface={this.props.surface}
        // Inline styles on purpose: the panel must stay visible and clickable
        // even when the failure came from the stylesheet or a token bundle.
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          alignItems: "flex-start",
          justifyContent: "center",
          minWidth: 0,
          padding: "24px",
          background: "white",
          border: "2px solid black",
          font: "14px/20px system-ui, sans-serif",
          color: "black",
          overflow: "auto",
        }}
      >
        <strong style={{ font: "700 16px/22px system-ui, sans-serif" }}>
          {this.props.surface}无法显示
        </strong>
        <span>
          此区域的界面渲染失败，其他区域和后台任务不受影响。历史与草稿保留在原有位置。
        </span>
        <code
          style={{
            font: "12px/18px ui-monospace, monospace",
            wordBreak: "break-word",
            padding: "8px",
            background: "rgb(0 0 0 / 6%)",
          }}
        >
          {diagnostic}
        </code>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            style={{
              font: "600 14px/20px system-ui, sans-serif",
              padding: "8px 12px",
              border: "2px solid black",
              background: "#ffd440",
              color: "black",
            }}
            onClick={() => this.setState({ diagnostic: undefined })}
          >
            {SURFACE_RECOVERY_RETRY_LABEL}
          </button>
          <button
            type="button"
            style={{
              font: "600 14px/20px system-ui, sans-serif",
              padding: "8px 12px",
              border: "2px solid black",
              background: "white",
              color: "black",
            }}
            onClick={() => window.location.reload()}
          >
            {SURFACE_RECOVERY_RELOAD_LABEL}
          </button>
        </div>
      </div>
    );
  }
}
