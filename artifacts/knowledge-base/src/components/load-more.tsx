import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LoadMore({ hasMore, onClick, loading = false, error = false }: {
  hasMore: boolean;
  onClick: () => void;
  loading?: boolean;
  error?: boolean;
}) {
  if (!hasMore && !error) return null;
  return <div className="col-span-full flex flex-col items-center gap-2 pt-4 pb-2">
    {error && <p role="alert" className="text-sm text-destructive">Could not load more entries. Please try again.</p>}
    <Button type="button" variant="outline" onClick={onClick} disabled={loading}>
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {loading ? "Loading..." : "Load more..."}
    </Button>
  </div>;
}