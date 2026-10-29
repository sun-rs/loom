import { useIntl } from "react-intl";
// New upstream message IDs, through the existing app locale. No second store.
const labels: Record<string, string> = {
  "message.messageItem.selectText": "选择文本",
  "message.messageItem.selectTextHint": "长按以选择文本。",
  "message.messageItem.selectTextBody": "来自 {sender} 的消息",
};
export function useSelectionIntl() {
  const intl = useIntl();
  return {
    formatMessage: (
      descriptor: { id: string },
      values?: Record<string, string>,
    ) =>
      intl.formatMessage(
        { ...descriptor, defaultMessage: labels[descriptor.id] },
        values,
      ),
  };
}
