import { MessageIcon } from "raft-ui";
import type { ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  BookOpen,
  Monitor,
  Users,
  Search,
  File,
} from "lucide-react";
import EmptyState from "@loom/raft-web-source/EmptyState";
// Official EmptyState composition; labels from Web 1.21.35 Chinese resources.
// Role/Memory labels adapt the same scenarios to Loom's explicit product concepts.
const scenarios = {
  channels: {
    icon: MessageIcon,
    title: "还没有频道",
    description: "创建频道，开始对话。",
  },
  conversation: {
    icon: MessageIcon,
    title: "没有打开的对话",
    description: "从列表里选一个。",
  },
  messages: {
    icon: MessageIcon,
    title: "还没有消息",
    description: "开始对话吧。",
  },
  roles: {
    icon: Users,
    title: "还没有角色",
    description: "创建角色后，可以将其实例添加到频道。",
  },
  computers: {
    icon: Monitor,
    title: "还没有计算机",
    description: "选择一台计算机查看详情。",
  },
  memory: {
    icon: BookOpen,
    title: "还没有记忆",
    description: "频道共享的记忆会显示在这里。",
  },
  activity: {
    icon: Activity,
    title: "还没有活动",
    description: "实例开始工作后，执行记录会显示在这里。",
  },
  search: {
    icon: Search,
    title: "没有匹配的结果",
    description: "换一个关键词或筛选条件。",
  },
  files: {
    icon: File,
    title: "还没有文件",
    description:
      "在聊天中添加附件，或将文件拖入消息编辑框。消息发送后文件会显示在这里。",
  },
  unavailable: {
    icon: AlertCircle,
    title: "无法打开",
    description: "内容不存在，或你没有访问权限。",
  },
} as const;
export default function PageEmpty({
  kind,
  title,
  description,
  action,
  className = "flex h-full min-h-0 flex-1 flex-col items-center justify-center",
  testId,
}: {
  kind: keyof typeof scenarios;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  testId?: string;
}) {
  const scenario = scenarios[kind],
    Icon = scenario.icon;
  return (
    <EmptyState
      data-testid={testId ?? "empty-" + kind}
      className={className}
      icon={<Icon width={36} height={36} />}
      title={title ?? scenario.title}
      description={description ?? scenario.description}
      action={action}
    />
  );
}
