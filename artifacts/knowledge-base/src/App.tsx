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

function ProtectedRoute({ component: Component, adminOnly = false, editorOnly = false }: { component: any, adminOnly?: boolean, editorOnly?: boolean }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;
  if (!user) return <Redirect to="/login" />;

  if (adminOnly && user.role !== 'admin') {
    return <Redirect to="/" />;
  }

  if (editorOnly && user.role !== 'admin' && user.role !== 'editor') {
    return <Redirect to="/" />;
  }

  return (
    <MainLayout>
      <Component />
    </MainLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      
      <Route path="/">
        <ProtectedRoute component={Home} />
      </Route>
      <Route path="/articles">
        <ProtectedRoute component={Articles} />
      </Route>
      <Route path="/maintenance">
        <ProtectedRoute component={Maintenance} />
      </Route>
      <Route path="/settings">
        <ProtectedRoute component={Settings} />
      </Route>
      
      <Route path="/wiki/new">
        <ProtectedRoute component={ArticleEdit} editorOnly />
      </Route>
      <Route path="/wiki/:slug/edit">
        <ProtectedRoute component={ArticleEdit} editorOnly />
      </Route>
      <Route path="/wiki/:slug">
        <ProtectedRoute component={ArticleView} />
      </Route>

      <Route path="/admin">
        <ProtectedRoute component={AdminDashboard} adminOnly />
      </Route>
      <Route path="/admin/users">
        <ProtectedRoute component={AdminUsers} adminOnly />
      </Route>
      <Route path="/admin/groups">
        <ProtectedRoute component={AdminGroups} adminOnly />
      </Route>
      <Route path="/admin/import-export">
        <ProtectedRoute component={AdminImport} adminOnly />
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
