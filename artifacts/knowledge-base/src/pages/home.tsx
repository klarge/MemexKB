import { useGetArticle } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Redirect } from "wouter";
import ArticleView from "./article";

export default function Home() {
  const { data: article, isLoading, isError } = useGetArticle("home", {
    query: {
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

  // We can just use the ArticleView component but provide it the home slug or let it read from route if we pass params
  // To keep it simple, we just render the content here or reuse the component.
  // We'll reuse the logic from ArticleView by using wouter's route but since we are at /, 
  // maybe it's better to just render the article directly.
  return <ArticleView params={{ slug: "home" }} />;
}
