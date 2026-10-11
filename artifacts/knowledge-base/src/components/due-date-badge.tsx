import { format, isPast, isToday, parseISO } from "date-fns";

export function DueDateBadge({ dueDate, completed = false }: { dueDate: string; completed?: boolean }) {
  // Date pickers submit calendar dates. Keep that date when displaying a
  // UTC-midnight database value, even in time zones west of UTC.
  const date = parseISO(dueDate.slice(0, 10));
  const overdue = !completed && isPast(date) && !isToday(date);
  const today = !completed && isToday(date);
  return (
    <span
      title={`Due ${format(date, "PPP")}`}
      aria-label={`Due ${format(date, "PPP")}${overdue ? ", overdue" : ""}`}
      className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded ${
        overdue
          ? "bg-destructive/10 text-destructive"
          : today
          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {overdue ? "Overdue · " : today ? "Today · " : ""}
      {format(date, "MMM d")}
    </span>
  );
}
