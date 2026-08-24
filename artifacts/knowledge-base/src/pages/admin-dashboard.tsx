import { useGetArticleStats } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Users, Shield, Lock, Calendar, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

export default function AdminDashboard() {
  const { data: stats, isLoading } = useGetArticleStats();

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of your knowledge base.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Articles</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalArticles || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Restricted Articles</CardTitle>
            <Lock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.restrictedArticles || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalUsers || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Groups</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalGroups || 0}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recently Updated</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats?.recentlyUpdated?.map(article => (
                <div key={article.id} className="flex items-start justify-between border-b pb-4 last:border-0 last:pb-0">
                  <div>
                    <Link href={`/knowledge/${article.slug}`} className="font-medium hover:text-primary transition-colors flex items-center gap-2">
                      {article.title}
                      {article.isRestricted && <Lock className="h-3 w-3 text-muted-foreground" />}
                    </Link>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                      <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {format(new Date(article.updatedAt), "MMM d, yyyy")}</span>
                      {article.updatedByName && <span>by {article.updatedByName}</span>}
                    </div>
                  </div>
                </div>
              ))}
              {(!stats?.recentlyUpdated || stats.recentlyUpdated.length === 0) && (
                <div className="text-sm text-muted-foreground">No recent updates</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Needs Review (Oldest)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats?.oldestUpdated?.map(article => (
                <div key={article.id} className="flex items-start justify-between border-b pb-4 last:border-0 last:pb-0">
                  <div>
                    <Link href={`/knowledge/${article.slug}`} className="font-medium hover:text-primary transition-colors flex items-center gap-2">
                      {article.title}
                    </Link>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                      <span className="flex items-center gap-1 text-amber-600"><Calendar className="h-3 w-3" /> {format(new Date(article.updatedAt), "MMM d, yyyy")}</span>
                      {article.updatedByName && <span>by {article.updatedByName}</span>}
                    </div>
                  </div>
                </div>
              ))}
              {(!stats?.oldestUpdated || stats.oldestUpdated.length === 0) && (
                <div className="text-sm text-muted-foreground">All articles are up to date</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
