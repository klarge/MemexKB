import { Link } from "wouter";
import { Star, Loader2 } from "lucide-react";
import { useFavorites } from "@/hooks/use-favorites";
import { useVisibleItems } from "@/hooks/use-visible-items";
import { useAuth } from "@/lib/auth";
import { articlePathFor, KIND_LABEL } from "@/lib/content-paths";
import { FavoriteButton } from "./favorite-button";
import { LoadMore } from "./load-more";
import { Button } from "./ui/button";

export function HomeFavorites() {
  const { user } = useAuth();
  const favorites = useFavorites();
  const window = useVisibleItems(favorites.data?.items ?? [], String(user?.id));
  return <section aria-labelledby="home-favorites-title">
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3 min-h-9">
      <div className="flex items-center gap-2">
        <Star className="h-4 w-4 text-muted-foreground" />
        <h2 id="home-favorites-title" className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Favorites</h2>
      </div>
    </div>
    <div className="rounded-lg border bg-card divide-y divide-border overflow-hidden">
    {favorites.isPending ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> :
      favorites.isError ? <div role="alert" className="text-sm space-y-2 px-4 py-8 text-center">
        <p className="text-destructive">Could not load your favorites.</p>
        <Button variant="outline" size="sm" onClick={() => favorites.refetch()}>Try again</Button>
      </div> : !window.items.length ?
        <p className="py-8 px-4 text-center text-sm text-muted-foreground">Star articles, policies, procedures, or projects to keep them here.</p> :
        <>
          {window.items.map(item => <div key={`${item.entityType}:${item.entityId}`} className="flex items-center gap-2 px-4 py-3 hover:bg-muted/40 transition-colors">
            <Link className="min-w-0 flex-1 hover:text-primary" href={item.entityType === "project"
              ? `/projects/${item.entityId}` : articlePathFor({ kind: item.kind, slug: item.slug! })}>
              <p className="truncate text-sm font-medium">{item.title}</p>
              <p className="text-xs text-muted-foreground">{item.kind === "project" ? "Project" : KIND_LABEL[item.kind]}{item.archived ? " · Archived" : ""}</p>
            </Link>
            <FavoriteButton entityType={item.entityType} entityId={item.entityId} title={item.title} />
          </div>)}
          <LoadMore hasMore={window.hasMore} onClick={window.loadMore} />
        </>}
    </div>
  </section>;
}