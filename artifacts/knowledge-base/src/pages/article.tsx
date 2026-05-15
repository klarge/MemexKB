import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetArticle, useGetArticleBacklinks, getGetArticleQueryKey, getGetArticleBacklinksQueryKey, useDeleteArticle } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Edit, Trash2, Download, Lock, ChevronLeft, FileText } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function ArticleView({ params }: { params?: { slug?: string } }) {
  const { slug } = params || {};
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const isHome = !slug || slug === "home";
  const actualSlug = slug || "home";

  const { data: article, isLoading, isError } = useGetArticle(actualSlug, {
    query: {
      enabled: !!actualSlug,
      queryKey: getGetArticleQueryKey(actualSlug),
      retry: false,
    }
  });

  const { data: backlinks } = useGetArticleBacklinks(actualSlug, {
    query: {
      enabled: !!actualSlug && !!article?.canAccess,
      queryKey: getGetArticleBacklinksQueryKey(actualSlug),
    }
  });

  const deleteMutation = useDeleteArticle();

  const handleDelete = () => {
    deleteMutation.mutate({ slug: actualSlug }, {
      onSuccess: () => {
        toast({ title: "Article deleted" });
        setLocation("/articles");
      },
      onError: (err) => {
        toast({ title: "Error deleting article", description: err.error || "Unknown error", variant: "destructive" });
      }
    });
  };

  const processContent = (html: string) => {
    // Replace [[Wikilink]] with an a tag
    return html.replace(/\[\[(.*?)\]\]/g, (match, title) => {
      const linkSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return `<a href="/wiki/${linkSlug}" class="text-primary hover:underline font-medium" data-wikilink="true">${title}</a>`;
    });
  };

  useEffect(() => {
    const handleWikilinkClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'A' && target.getAttribute('data-wikilink') === 'true') {
        e.preventDefault();
        const href = target.getAttribute('href');
        if (href) setLocation(href);
      }
    };
    document.addEventListener('click', handleWikilinkClick);
    return () => document.removeEventListener('click', handleWikilinkClick);
  }, [setLocation]);

  const exportPdf = () => {
    window.open(`/api/articles/${actualSlug}/export/pdf`, '_blank');
  };

  const exportMd = () => {
    window.location.href = `/api/articles/${actualSlug}/export/md`;
  };

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !article) {
    if (isHome) {
      setLocation("/articles");
      return null;
    }
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-2">Article not found</h2>
        <p className="text-muted-foreground mb-6">The article you're looking for doesn't exist.</p>
        <Button onClick={() => setLocation("/articles")}>
          <ChevronLeft className="mr-2 h-4 w-4" />
          Back to articles
        </Button>
      </div>
    );
  }

  const canEdit = user?.role === 'admin' || user?.role === 'editor';

  return (
    <div className="flex flex-col lg:flex-row gap-8 pb-20">
      <div className="flex-1 max-w-3xl min-w-0">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-4xl font-extrabold tracking-tight" data-testid="article-title">{article.title}</h1>
              {article.isRestricted && (
                <Badge variant="outline" className="border-primary/20 text-primary bg-primary/5">
                  <Lock className="w-3 h-3 mr-1" />
                  Restricted
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>Last updated: {format(new Date(article.updatedAt), "MMMM d, yyyy 'at' h:mm a")}</span>
              {article.updatedByName && <span>by {article.updatedByName}</span>}
            </div>
          </div>
        </div>

        {!article.canAccess ? (
          <Card className="border-dashed bg-muted/30">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Lock className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
              <h3 className="font-semibold text-lg mb-2">Members Only</h3>
              <p className="text-muted-foreground max-w-sm">
                This article is restricted. You do not have the required group access to view its contents.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div 
            className="prose prose-stone dark:prose-invert max-w-none prose-headings:font-semibold prose-a:text-primary prose-img:rounded-lg mt-8"
            dangerouslySetInnerHTML={{ __html: processContent(article.content) }}
            data-testid="article-content"
          />
        )}
      </div>

      <div className="w-full lg:w-64 shrink-0 space-y-6">
        {canEdit && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <Button className="w-full justify-start" variant="outline" onClick={() => setLocation(`/wiki/${actualSlug}/edit`)} data-testid="button-edit-article">
                <Edit className="mr-2 h-4 w-4" /> Edit Article
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button className="w-full justify-start" variant="outline" data-testid="button-delete-article">
                    <Trash2 className="mr-2 h-4 w-4 text-destructive" /> <span className="text-destructive">Delete</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. This will permanently delete the article.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        )}

        {article.canAccess && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Export</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="secondary" className="w-full justify-start" onClick={exportPdf}>
                <Download className="mr-2 h-4 w-4" /> Download PDF
              </Button>
              <Button variant="secondary" className="w-full justify-start" onClick={exportMd}>
                <FileText className="mr-2 h-4 w-4" /> Download Markdown
              </Button>
            </CardContent>
          </Card>
        )}

        {article.canAccess && backlinks && backlinks.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Linked From</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {backlinks.map(link => (
                  <li key={link.id}>
                    <Link href={`/wiki/${link.slug}`} className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-2">
                      <FileText className="h-3 w-3" />
                      <span className="truncate">{link.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {article.groups && article.groups.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Required Groups</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {article.groups.map(g => (
                  <Badge key={g.id} variant="secondary">{g.name}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
