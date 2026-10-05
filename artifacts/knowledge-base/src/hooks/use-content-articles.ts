import { useInfiniteQuery } from "@tanstack/react-query";
import { listArticles, getListArticlesQueryKey, type ListArticlesParams } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { CONTENT_PAGE_SIZE } from "./use-visible-items";

export function useContentArticles(params: ListArticlesParams) {
  const { user } = useAuth();
  const query = useInfiniteQuery({
    queryKey: [...getListArticlesQueryKey(params), "load-more", user?.id],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => listArticles({ ...params, limit: CONTENT_PAGE_SIZE, offset: pageParam }, { signal }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.articles.length, 0);
      return last.articles.length > 0 && loaded < last.total ? loaded : undefined;
    },
    // Revisiting an area or filter starts with its first twenty entries.
    gcTime: 0,
  });
  const last = query.data?.pages.at(-1);
  const seen = new Set<number>();
  const articles = query.data?.pages.flatMap(page => page.articles).filter(article => {
    if (seen.has(article.id)) return false;
    seen.add(article.id);
    return true;
  }) ?? [];
  return {
    ...query,
    isError: query.isError && !query.data,
    data: last ? { ...last, articles } : undefined,
  };
}