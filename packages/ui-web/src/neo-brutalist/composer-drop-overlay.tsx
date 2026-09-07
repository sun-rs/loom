/** Structural Raft class adoption; see docs/design/composer-file-drop.md. */
export function ComposerDropOverlay() {
  return (
    <div
      aria-hidden="true"
      className="rah-composer-drop-overlay"
      data-testid="composer-drop-overlay"
    >
      <span>拖放文件以添加附件</span>
    </div>
  );
}
