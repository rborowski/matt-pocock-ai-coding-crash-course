import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "~/lib/utils";

// ─── Star rating display + input ───
// Read-only pieces (StarRow, RatingSummary) support fractional averages by
// overlaying a width-clipped filled star row on top of an empty one, so e.g.
// a 4.6 average renders as 4 full stars + a 60%-filled 5th star.

export function StarRow({
  value,
  size = "size-4",
  className,
}: {
  value: number;
  size?: string;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-0.5", className)}>
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = Math.max(0, Math.min(1, value - star + 1));
        return (
          <span key={star} className={cn("relative shrink-0", size)}>
            <Star
              className={cn(size, "absolute inset-0 text-muted-foreground/30")}
            />
            <span
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fill * 100}%` }}
            >
              <Star className={cn(size, "fill-amber-400 text-amber-400")} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function RatingSummary({
  average,
  count,
  size = "size-4",
  className,
}: {
  average: number;
  count: number;
  size?: string;
  className?: string;
}) {
  if (count === 0) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        No ratings yet
      </span>
    );
  }

  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      <StarRow value={average} size={size} />
      <span className="font-medium text-foreground">{average.toFixed(1)}</span>
      <span className="text-muted-foreground">({count})</span>
    </span>
  );
}

export function StarPicker({
  value,
  onChange,
  size = "size-8",
  disabled = false,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  size?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;

  function handleClick(star: number) {
    // Ignore clicks while a save is in flight instead of setting the
    // `disabled` attribute on the button, which would yank keyboard focus
    // to <body> right after the user activates it.
    if (disabled) return;
    onChange(star);
  }

  return (
    <div
      className={cn("flex items-center gap-1", className)}
      role="radiogroup"
      aria-label="Rate this course"
      aria-busy={disabled}
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          aria-label={`Rate ${star} ${star === 1 ? "star" : "stars"}`}
          aria-pressed={value === star}
          onMouseEnter={() => setHover(star)}
          onFocus={() => setHover(star)}
          onBlur={() => setHover(0)}
          onClick={() => handleClick(star)}
          className={cn(
            "rounded transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            disabled && "cursor-not-allowed opacity-60 hover:scale-100"
          )}
        >
          <Star
            className={cn(
              size,
              star <= shown
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/40"
            )}
          />
        </button>
      ))}
    </div>
  );
}
