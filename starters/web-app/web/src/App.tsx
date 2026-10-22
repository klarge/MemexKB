import { useEffect, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { MainLayout } from "@/components/layout/MainLayout";
import { applyAccentColor, ThemeProvider, useTheme } from "@/lib/theme";
import { FAVICON_URL, useSiteSettings } from "@/lib/site-settings";

import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Setup from "@/pages/setup";
import ResetPassword from "@/pages/reset-password";
import Settings from "@/pages/settings";
import Home from "@/pages/home";
import AdminUsers from "@/pages/admin-users";
import AdminGroups from "@/pages/admin-groups";
import AdminSso from "@/pages/admin-sso";
import AdminCustomization from "@/pages/admin-customization";

const queryClient = new QueryClient();

function TitleSync() {
  const { data: settings } = useSiteSettings();
  const { theme } = useTheme();
  useEffect(() => {
    document.title = settings?.siteName ?? "My App";
    const href = settings?.hasFavicon
      ? `${FAVICON_URL}?v=${encodeURIComponent(settings.faviconVersion ?? String(Date.now()))}`
      : "/favicon.svg";
    const type = settings?.hasFavicon ? (settings.faviconMimeType ?? "image/png") : "image/svg+xml";
    for (const rel of ["icon", "shortcut icon", "apple-touch-icon"]) {
      const icon = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`) ?? document.createElement("link");
      icon.rel = rel;
      icon.type = type;
      icon.href = href;
      if (!icon.parentNode) document.head.appendChild(icon);
    }
    applyAccentColor(settings?.accentColor);
  }, [settings, theme]);
  return null;
}

// Redirects to /setup until an admin exists, and away from /setup afterwards.
function SetupGuard({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data, isLoading, isError, refetch } = useQuery<{ needsSetup: boolean }>({
    queryKey: ["setup-status"],
    queryFn: async () => {
      const r = await fetch("/api/auth/setup-status");
      if (!r.ok) throw new Error("Unable to check setup status");
      return r.json();
    },
    staleTime: Infinity,
    retry: false,
  });
  if (isLoading) return null;
  if (isError) return <div role="alert" className="p-8">Unable to check setup status. <button onClick={() => void refetch()} className="underline">Try again</button></div>;
  const needsSetup = data?.needsSetup ?? false;
  const onSetup = location === "/setup";
  if (needsSetup && !onSetup) return <Redirect to="/setup" />;
  if (!needsSetup && onSetup) return <Redirect to="/login" />;
  return <>{children}</>;
}

function AuthRoute({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user) return <Redirect to="/login" />;
  if (adminOnly && user.role !== "admin") return <Redirect to="/" />;
  return <MainLayout>{children}</MainLayout>;
}

function Router() {
  return (
    <SetupGuard>
      <Switch>
        <Route path="/setup" component={Setup} />
        <Route path="/login" component={Login} />
        <Route path="/recovery" component={ResetPassword} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/"><AuthRoute><Home /></AuthRoute></Route>
        <Route path="/settings"><AuthRoute><Settings /></AuthRoute></Route>
        <Route path="/admin/users"><AuthRoute adminOnly><AdminUsers /></AuthRoute></Route>
        <Route path="/admin/groups"><AuthRoute adminOnly><AdminGroups /></AuthRoute></Route>
        <Route path="/admin/sso"><AuthRoute adminOnly><AdminSso /></AuthRoute></Route>
        <Route path="/admin/customization"><AuthRoute adminOnly><AdminCustomization /></AuthRoute></Route>
        <Route path="/admin"><Redirect to="/admin/users" /></Route>
        <Route component={NotFound} />
      </Switch>
    </SetupGuard>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <TitleSync />
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <Router />
            </AuthProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
