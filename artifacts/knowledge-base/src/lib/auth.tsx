import { createContext, useContext, useEffect, ReactNode } from "react";
import { takeOAuthReturn } from "./oauth-return";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe, getGetMeQueryKey, AuthUser } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
let lastResolvedUserId: number | null | undefined;

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: user, error, isLoading, isFetching, refetch } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
      refetchOnWindowFocus: true,
      refetchInterval: 60_000,
    }
  });

  const signedOut = error?.status === 401;
  const resolvedUser = signedOut ? null : user ?? null;

  useEffect(() => {
    if (resolvedUser) {
      const destination = takeOAuthReturn();
      if (destination) window.location.replace(destination);
    }
  }, [resolvedUser?.id]);

  // A network/server/429 error is not evidence that the session has expired.
  if (!isLoading && (!error || signedOut)) {
    const currentUserId = resolvedUser?.id ?? null;
    if (lastResolvedUserId !== undefined && lastResolvedUserId !== currentUserId) {
      const authQueryKey = getGetMeQueryKey();
      queryClient.removeQueries({
        predicate: (query) => JSON.stringify(query.queryKey) !== JSON.stringify(authQueryKey),
      });
    }
    lastResolvedUserId = currentUserId;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error && !signedOut && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-4 text-center" role="alert">
          <h1 className="text-xl font-semibold">Unable to check your session</h1>
          <p className="text-sm text-muted-foreground">
            {error.status === 429
              ? "The server is temporarily limiting requests. Wait a minute, then try again. This does not mean you have been signed out."
              : "The server could not be reached. Try again to continue without signing out."}
          </p>
          <button
            type="button"
            disabled={isFetching}
            onClick={() => void refetch()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {isFetching ? "Checking…" : "Try again"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user: resolvedUser,
        isLoading,
        logout: () => {
          // handled in MainLayout via useLogout
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
