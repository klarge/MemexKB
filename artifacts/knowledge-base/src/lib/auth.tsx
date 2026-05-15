import { createContext, useContext, ReactNode, useEffect } from "react";
import { useGetMe, getGetMeQueryKey, AuthUser } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: user, isLoading, isError } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
      refetchOnWindowFocus: false,
    }
  });

  useEffect(() => {
    if (isError && location !== "/login") {
      setLocation("/login");
    }
  }, [isError, location, setLocation]);

  if (isLoading && location !== "/login") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user: user || null,
        isLoading,
        logout: () => {
          // handled elsewhere
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
