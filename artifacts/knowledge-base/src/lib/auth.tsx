import { createContext, useContext, ReactNode } from "react";
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
  const { data: user, isLoading } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
      refetchOnWindowFocus: false,
    }
  });

  if (!isLoading) {
    const currentUserId = user?.id ?? null;
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

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
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
