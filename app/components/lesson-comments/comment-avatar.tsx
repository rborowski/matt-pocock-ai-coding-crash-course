import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { cn } from "~/lib/utils";

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function CommentAvatar({
  name,
  avatarUrl,
  small,
  className,
}: {
  name: string;
  avatarUrl: string | null;
  small?: boolean;
  className?: string;
}) {
  return (
    <Avatar
      size={small ? "sm" : "default"}
      className={cn("mt-0.5", className)}
    >
      {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
      <AvatarFallback>{getInitials(name)}</AvatarFallback>
    </Avatar>
  );
}
