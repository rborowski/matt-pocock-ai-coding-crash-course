import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

const BADGE_STYLES = {
  instructor:
    "border-transparent bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  admin:
    "border-transparent bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
} as const;

const BADGE_LABELS = { instructor: "Instructor", admin: "Admin" } as const;

export function CommentRoleBadge({
  badge,
  className,
}: {
  badge: "instructor" | "admin" | null;
  className?: string;
}) {
  if (!badge) return null;
  return (
    <Badge
      variant="secondary"
      className={cn(
        "px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide",
        BADGE_STYLES[badge],
        className
      )}
    >
      {BADGE_LABELS[badge]}
    </Badge>
  );
}
