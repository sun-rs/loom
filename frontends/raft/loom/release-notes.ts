/** Curated shipped Loom changes, verified against the linked Git commits. Not Raft releases. */
export const loomReleaseNotes = (
  [
    {
      commit: "7dd4aa7",
      date: "2026-10-17",
      entries: [
        {
          type: "fix",
          text: "修复手机可视区域缩短时底部导航被裁切；恢复原生主题底栏与首页入口。",
        },
        { type: "improvement", text: "界面固定使用简体中文。" },
      ],
    },
    {
      commit: "afa7aac",
      date: "2026-10-17",
      entries: [
        {
          type: "fix",
          text: "消息列显示真实未读回复数，点击定位首条未读回复；可见区域以外的回复不会被误标已读。",
        },
      ],
    },
    {
      commit: "ed72c00",
      date: "2026-10-17",
      entries: [
        {
          type: "feature",
          text: "支持在 Loom 中浏览 PDF，保留原生下载与关闭操作。PDF 评论暂不开放。",
        },
      ],
    },
  ] as const
).map(({ commit, date, entries }) => ({
  releaseId: commit,
  version: null,
  date,
  state: "published" as const,
  entries: entries.map((entry, ordinal) => ({
    ...entry,
    entryId: `${commit}:${ordinal}`,
    emphasis: false,
    ordinal,
  })),
}));
