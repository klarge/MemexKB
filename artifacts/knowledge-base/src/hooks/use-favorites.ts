import { useQuery } from "@tanstack/react-query";
import { listFavorites } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";

export function useFavorites() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["favorites", user?.id],
    queryFn: ({ signal }) => listFavorites({ signal }),
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}