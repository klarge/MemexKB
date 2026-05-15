import { useGetArticle, getGetArticleQueryKey } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Redirect } from "wouter";
import ArticleView from "./article";

export default function Home() {
  const { data: article, isLoading, isError } = useGetArticle("home", {
    query: {
      queryKey: getGetArticleQueryKey("home"),
      retry: false,
    }
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !article) {
    return <Redirect to="/articles" />;
  }

  return <ArticleView params={{ slug: "home" }} />;
}
