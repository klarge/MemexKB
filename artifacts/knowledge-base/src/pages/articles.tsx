import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useListArticles, getListArticlesQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Lock, FileText, Search, Plus, Calendar, User as UserIcon } from "lucide-react";
import { format } from "date-fns";

export default function Articles() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<"title" | "updated_at" | "created_at">("updated_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  const { data, isLoading } = useListArticles({
    search: debouncedSearch || undefined,
    sort,
    order,
    limit: 50,
  }, {
    query: {
      queryKey: getListArticlesQueryKey({ search: debouncedSearch || undefined, sort, order, limit: 50 })
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Articles</h1>
          <p className="text-muted-foreground mt-1">Browse and search all knowledge base articles.</p>
        </div>
        {(user?.role === "admin" || user?.role === "editor") && (
          <Button onClick={() => setLocation("/wiki/new")} data-testid="button-new-article">
            <Plus className="mr-2 h-4 w-4" />
            New Article
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-center bg-card p-4 rounded-lg border shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search articles by title or content..." 
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Select value={sort} onValueChange={(v: "title" | "updated_at" | "created_at") => setSort(v)}>
            <SelectTrigger className="w-[140px]" data-testid="select-sort">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="title">Title</SelectItem>
              <SelectItem value="updated_at">Last Updated</SelectItem>
              <SelectItem value="created_at">Date Created</SelectItem>
            </SelectContent>
          </Select>
          <Select value={order} onValueChange={(v: "asc" | "desc") => setOrder(v)}>
            <SelectTrigger className="w-[110px]" data-testid="select-order">
              <SelectValue placeholder="Order" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">Descending</SelectItem>
              <SelectItem value="asc">Ascending</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-24 bg-muted animate-pulse rounded-lg border border-border/50" />
          ))}
        </div>
      ) : data?.articles?.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center h-48 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg">No articles found</h3>
            <p className="text-muted-foreground">Adjust your search or create a new article.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3" data-testid="list-articles">
          {data?.articles.map(article => (
            <Link key={article.id} href={`/wiki/${article.slug}`}>
              <Card className="hover-elevate cursor-pointer transition-colors group">
                <CardContent className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      {article.isRestricted ? <Lock className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg group-hover:text-primary transition-colors flex items-center gap-2" data-testid={`text-article-title-${article.id}`}>
                        {article.title}
                        {article.isRestricted && (
                          <Badge variant="outline" className="text-xs font-normal border-primary/20 text-primary bg-primary/5">Restricted</Badge>
                        )}
                      </h3>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(article.updatedAt), "MMM d, yyyy")}
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
          ))}
        </div>
      )}
    </div>
  );
}
