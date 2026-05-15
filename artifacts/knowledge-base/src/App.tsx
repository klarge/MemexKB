import type { ComponentType, ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { MainLayout } from "@/components/layout/MainLayout";

import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Settings from "@/pages/settings";
import Articles from "@/pages/articles";
import Maintenance from "@/pages/maintenance";
import Home from "@/pages/home";
import ArticleView from "@/pages/article";
import ArticleEdit from "@/pages/article-edit";
import AdminDashboard from "@/pages/admin-dashboard";
import AdminUsers from "@/pages/admin-users";
import AdminGroups from "@/pages/admin-groups";
import AdminImport from "@/pages/admin-import";

const queryClient = new QueryClient();

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
    <Switch>
      <Route path="/login" component={Login} />

      <Route path="/">
        <AuthRoute>
          <Home />
        </AuthRoute>
      </Route>

      <Route path="/articles">
        <PublicLayout>
          <Articles />
        </PublicLayout>
      </Route>

      <Route path="/maintenance">
        <AuthRoute adminOnly>
          <Maintenance />
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

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
