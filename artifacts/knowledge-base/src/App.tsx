import { useEffect, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { MainLayout } from "@/components/layout/MainLayout";
import { ThemeProvider } from "@/lib/theme";
import { useSiteSettings } from "@/lib/site-settings";

import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Setup from "@/pages/setup";
import Settings from "@/pages/settings";
import Home from "@/pages/home";
import ArticleView from "@/pages/article";
import ArticleEdit from "@/pages/article-edit";
import AdminDashboard from "@/pages/admin-dashboard";
import AdminUsers from "@/pages/admin-users";
import AdminGroups from "@/pages/admin-groups";
import AdminImport from "@/pages/admin-import";
import AdminTokens from "@/pages/admin-tokens";
import ArticleHistory from "@/pages/article-history";
import Templates from "@/pages/templates";
import TemplateEdit from "@/pages/template-edit";
import AdminSso from "@/pages/admin-sso";
import AdminCustomization from "@/pages/admin-customization";
import AdminTags from "@/pages/admin-tags";
import LogPage from "@/pages/log";
import TasksPage from "@/pages/tasks";
import ProjectsPage from "@/pages/projects";
import ProjectPage from "@/pages/project";
import BoardPage from "@/pages/board";
import Knowledge from "@/pages/articles";

const queryClient = new QueryClient();

function TitleSync() {
  const { data: settings } = useSiteSettings();
  useEffect(() => {
    document.title = settings?.siteName ?? "Memex";
  }, [settings?.siteName]);
  return null;
}

// Fetches whether the initial admin setup still needs to be completed.
// Redirects to /setup for all routes until setup is done;
// redirects away from /setup once an admin account exists.
function SetupGuard({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data, isLoading } = useQuery<{ needsSetup: boolean }>({
    queryKey: ["setup-status"],
    queryFn: () => fetch("/api/auth/setup-status").then((r) => r.json()),
    staleTime: Infinity,
    retry: false,
  });

  if (isLoading) return null;

  const needsSetup = data?.needsSetup ?? false;
  const onSetup = location === "/setup";

  if (needsSetup && !onSetup) return <Redirect to="/setup" />;
  if (!needsSetup && onSetup) return <Redirect to="/login" />;

  return <>{children}</>;
}

function AuthRoute({
  children,
  adminOnly = false,
  editorOnly = false,
}: {
  children: ReactNode;
  adminOnly?: boolean;
  editorOnly?: boolean;
}) {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;
  if (!user) return <Redirect to="/login" />;

  if (adminOnly && user.role !== "admin") {
    return <Redirect to="/" />;
  }

  if (editorOnly && user.role !== "admin" && user.role !== "editor") {
    return <Redirect to="/" />;
  }

  return <MainLayout>{children}</MainLayout>;
}

function PublicLayout({ children }: { children: ReactNode }) {
  return <MainLayout>{children}</MainLayout>;
}

function Router() {
  return (
    <SetupGuard>
    <Switch>
      <Route path="/setup" component={Setup} />
      <Route path="/login" component={Login} />

      <Route path="/">
        <AuthRoute>
          <Home />
        </AuthRoute>
      </Route>

      <Route path="/settings">
        <AuthRoute>
          <Settings />
        </AuthRoute>
      </Route>

      <Route path="/wiki/new">
        <AuthRoute editorOnly>
          <ArticleEdit />
        </AuthRoute>
      </Route>

      <Route path="/wiki/new/edit">
        <AuthRoute editorOnly>
          <ArticleEdit />
        </AuthRoute>
      </Route>

      <Route path="/wiki/:slug/edit">
        {(params: Record<string, string>) => (
          <AuthRoute editorOnly>
            <ArticleEdit params={params} />
          </AuthRoute>
        )}
      </Route>

      <Route path="/wiki/:slug">
        {(params: Record<string, string>) => (
          <PublicLayout>
            <ArticleView params={params} />
          </PublicLayout>
        )}
      </Route>

      <Route path="/admin">
        <AuthRoute adminOnly>
          <AdminDashboard />
        </AuthRoute>
      </Route>

      <Route path="/admin/users">
        <AuthRoute adminOnly>
          <AdminUsers />
        </AuthRoute>
      </Route>

      <Route path="/admin/groups">
        <AuthRoute adminOnly>
          <AdminGroups />
        </AuthRoute>
      </Route>

      <Route path="/admin/import-export">
        <AuthRoute adminOnly>
          <AdminImport />
        </AuthRoute>
      </Route>

      <Route path="/admin/tokens">
        <AuthRoute adminOnly>
          <AdminTokens />
        </AuthRoute>
      </Route>

      <Route path="/admin/sso">
        <AuthRoute adminOnly>
          <AdminSso />
        </AuthRoute>
      </Route>

      <Route path="/admin/customization">
        <AuthRoute adminOnly>
          <AdminCustomization />
        </AuthRoute>
      </Route>

      <Route path="/admin/tags">
        <AuthRoute adminOnly>
          <AdminTags />
        </AuthRoute>
      </Route>

      <Route path="/wiki/:slug/history">
        {(params: Record<string, string>) => (
          <AuthRoute editorOnly>
            <ArticleHistory params={params} />
          </AuthRoute>
        )}
      </Route>

      <Route path="/knowledge">
        <AuthRoute>
          <Knowledge />
        </AuthRoute>
      </Route>

      <Route path="/tasks">
        <AuthRoute>
          <TasksPage />
        </AuthRoute>
      </Route>

      <Route path="/projects">
        <AuthRoute>
          <ProjectsPage />
        </AuthRoute>
      </Route>

      <Route path="/projects/:projectId">
        {(params: Record<string, string>) => (
          <AuthRoute>
            <ProjectPage params={params} />
          </AuthRoute>
        )}
      </Route>

      <Route path="/projects/:projectId/boards/:boardId">
        {(params: Record<string, string>) => (
          <AuthRoute>
            <BoardPage params={params} />
          </AuthRoute>
        )}
      </Route>

      <Route path="/log">
        <AuthRoute>
          <LogPage />
        </AuthRoute>
      </Route>

      <Route path="/templates">
        <AuthRoute editorOnly>
          <Templates />
        </AuthRoute>
      </Route>

      <Route path="/templates/new">
        <AuthRoute editorOnly>
          <TemplateEdit />
        </AuthRoute>
      </Route>

      <Route path="/templates/:id/edit">
        {(params: Record<string, string>) => (
          <AuthRoute editorOnly>
            <TemplateEdit params={params} />
          </AuthRoute>
        )}
      </Route>

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
