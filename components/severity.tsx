import { cn } from "@/lib/utils";

type Severity = string | null | undefined;

const STYLES: Record<string, { dot: string; badge: string; label: string }> = {
  safe: {
    dot: "bg-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20",
    label: "SAFE",
  },
  warning: {
    dot: "bg-amber-500",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20",
    label: "WARNING",
  },
  critical: {
    dot: "bg-red-500",
    badge: "bg-red-500/10 text-red-700 dark:text-red-400 ring-red-500/20",
    label: "CRITICAL",
  },
};

const UNKNOWN = { dot: "bg-muted-foreground/40", badge: "bg-muted text-muted-foreground ring-border", label: "분석 전" };

const styleOf = (s: Severity) => (s && STYLES[s]) || UNKNOWN;

/** severity 신호등 점. */
export function SeverityDot({ severity, className }: { severity: Severity; className?: string }) {
  return <span className={cn("inline-block size-2.5 rounded-full", styleOf(severity).dot, className)} />;
}

/** severity 배지 (점 + 라벨). */
export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const s = styleOf(severity);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
        s.badge,
        className,
      )}
    >
      <span className={cn("inline-block size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}