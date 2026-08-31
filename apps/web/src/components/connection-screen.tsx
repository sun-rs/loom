import { useState } from "react";

import { Rail } from "./workspace-navigation.tsx";

export function ConnectionScreen({
  onConnect,
}: {
  onConnect: (accessToken: string) => void;
}) {
  const [accessToken, setAccessToken] = useState("");
  return (
    <div className="app thread-hidden rah-product-shell">
      <Rail />
      <aside className="sidebar rah-sidebar-placeholder">
        <header className="sidebar-head">
          <span className="sidebar-title">RAH OS</span>
        </header>
        <div className="sidebar-body">
          <p className="side-hint">Room-first multi-agent workspace</p>
        </div>
      </aside>
      <main className="channel rah-connect-stage">
        <form
          className="rah-connect-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (accessToken.trim().length > 0) onConnect(accessToken.trim());
          }}
        >
          <span className="rah-connect-mark">R</span>
          <h1>连接本机 RAH OS</h1>
          <p>
            浏览器通过同源代理连接 daemon。Human PAT
            只保存在当前页面内存，不写入 Local Storage。
          </p>
          <label>
            Human access token
            <input
              autoComplete="off"
              autoFocus
              onChange={(event) => setAccessToken(event.target.value)}
              type="password"
              value={accessToken}
            />
          </label>
          <button className="btn btn-pink" disabled={accessToken.trim() === ""}>
            进入 Workspace
          </button>
        </form>
      </main>
    </div>
  );
}
