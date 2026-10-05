import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateFavorite } from "@workspace/api-client-react";
import { Star, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFavorites } from "@/hooks/use-favorites";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

export function FavoriteButton({ entityType, entityId, title }: {
  entityType: "article" | "project"; entityId: number; title: string;
}) {
  const { user } = useAuth();
  const favorites = useFavorites();
  const qc = useQueryClient();
  const { toast } = useToast();
  const selected = favorites.data?.items.some(item => item.entityType === entityType && item.entityId === entityId) ?? false;
  const save = useMutation({
    mutationFn: (favorite: boolean) => updateFavorite({ entityType, entityId, favorite }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["favorites", user?.id] }),
    onError: () => toast({ title: "Could not update favorite", description: "Please try again.", variant: "destructive" }),
  });
  if (!user) return null;
  const label = selected ? "Remove from favorites" : "Add to favorites";
  return <Button type="button" variant="ghost" size="icon" className="shrink-0"
    aria-label={`${label}: ${title}`} aria-pressed={selected} title={label}
    disabled={favorites.isPending || save.isPending}
    onClick={event => {
      event.preventDefault();
      event.stopPropagation();
      if (favorites.isError && !favorites.data) {
        void favorites.refetch();
        toast({ title: "Reloading favorites", description: "Please try again when your favorites finish loading." });
      } else save.mutate(!selected);
    }}>
    {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> :
      <Star className={`h-4 w-4 ${selected ? "fill-amber-400 text-amber-500" : "text-muted-foreground"}`} />}
  </Button>;
}