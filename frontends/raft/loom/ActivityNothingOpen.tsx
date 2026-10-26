// Structural composition of Web 1.21.34 T3e + RF. Resource provenance:
// upstream/published-2026-10-26/manifest.json. Only the Chinese strings are local.
import { MessageSquare } from "lucide-react";
import {
  EmptyState,
  EmptyStateIcon,
  EmptyStateContent,
  EmptyStateTitle,
  EmptyStateDescription,
} from "raft-ui";
export default function ActivityNothingOpen() {
  return (
    <EmptyState className="flex-1" data-testid="activity-nothing-open">
      <EmptyStateIcon>
        <MessageSquare />
      </EmptyStateIcon>
      <EmptyStateContent>
        <EmptyStateTitle render={<h2 />}>没有打开的对话</EmptyStateTitle>
        <EmptyStateDescription>从列表里选一个。</EmptyStateDescription>
      </EmptyStateContent>
    </EmptyState>
  );
}
