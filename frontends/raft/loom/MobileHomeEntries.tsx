import { Activity, Search } from "lucide-react";
/** Sidebar.tsx mobile Home entries; official row styling, local route owner. */
export default function MobileHomeEntries({
  onSelect,
}: {
  onSelect: (id: "search" | "activity") => void;
}) {
  return (
    <div className="md:hidden">
      {(
        [
          { id: "search", label: "搜索", icon: Search },
          { id: "activity", label: "动态", icon: Activity },
        ] as const
      ).map((entry) => (
        <button
          key={entry.id}
          type="button"
          data-testid={`mobile-home-${entry.id}-entry`}
          onClick={() => onSelect(entry.id)}
          className="mb-1 flex w-full items-center gap-1.5 px-2 py-2 [@media(max-height:600px)]:py-1 md:py-1 text-left text-sm font-medium border border-transparent transition-colors hover:border-line-strong hover:bg-fill-muted hover:shadow-raft-sm active:border-line-strong active:bg-fill-muted active:shadow-raft-sm theme-brutal:border-2 theme-brutal:hover:border-black theme-brutal:hover:bg-white theme-brutal:hover:shadow-brutal-sm theme-brutal:active:border-black theme-brutal:active:bg-white theme-brutal:active:shadow-brutal-sm"
        >
          <entry.icon size={14} className="shrink-0" />
          {entry.label}
        </button>
      ))}
    </div>
  );
}
