import { useListArticlesMaintenance } from "@workspace/api-client-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Calendar, User as UserIcon, AlertTriangle, FileText, Lock } from "lucide-react";

export default function Maintenance() {
  const { data, isLoading } = useListArticlesMaintenance({ limit: 100 });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            Maintenance
          </h1>
          <p className="text-muted-foreground mt-1">
            Articles sorted by oldest last-modified date. Review these to ensure documentation stays fresh.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded-lg border border-border/50" />
          ))}
        </div>
      ) : data?.articles?.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center h-48 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg">No articles found</h3>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3" data-testid="list-maintenance">
          {data?.articles.map(article => {
            const isStale = new Date().getTime() - new Date(article.updatedAt).getTime() > 1000 * 60 * 60 * 24 * 180; // 6 months

            return (
              <Link key={article.id} href={`/wiki/${article.slug}`}>
                <Card className={`hover-elevate cursor-pointer transition-colors group ${isStale ? 'border-amber-500/30 bg-amber-500/5' : ''}`}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        {article.isRestricted ? <Lock className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg group-hover:text-primary transition-colors flex items-center gap-2">
                          {article.title}
                          {isStale && (
                            <Badge variant="outline" className="text-xs font-normal border-amber-500/50 text-amber-600 bg-amber-500/10">Needs Review</Badge>
                          )}
                        </h3>
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1 font-medium text-foreground/80">
                            <Calendar className="h-3 w-3" />
                            Updated: {format(new Date(article.updatedAt), "MMM d, yyyy")}
                          </span>
                          {article.updatedByName && (
                            <span className="flex items-center gap-1">
                              <UserIcon className="h-3 w-3" />
                              {article.updatedByName}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
