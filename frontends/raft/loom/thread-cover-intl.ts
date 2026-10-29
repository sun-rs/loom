import { useIntl } from "react-intl";
export function useCoverIntl() {
  const intl = useIntl();
  return {
    formatMessage: (
      descriptor: { id: string },
      values?: Record<string, unknown>,
    ) => {
      const labels: Record<string, string> = {
        "task.sideColumn.coverBack": "返回频道",
        "task.sideColumn.coverSwitch": "切换侧栏内容",
      };
      return (
        labels[descriptor.id] ?? intl.formatMessage(descriptor, values as never)
      );
    },
  };
}
