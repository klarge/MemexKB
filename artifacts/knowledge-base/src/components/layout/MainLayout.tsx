import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useLogout } from "@workspace/api-client-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarSeparator
} from "@/components/ui/sidebar";
import { 
  Book, 
  Home, 
  List, 
  Settings, 
  Wrench, 
  Users, 
  Shield, 
  Database,
  LogOut,
  Search,
  KeyRound,
  LayoutTemplate,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function MainLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const logout = useLogout();

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        setLocation("/login");
        window.location.reload();
      }
    });
  };

  const onSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && e.currentTarget.value) {
      setLocation(`/articles?search=${encodeURIComponent(e.currentTarget.value)}`);
    }
  };

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <Sidebar className="border-r border-border bg-sidebar">
          <SidebarHeader className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold">
                L
              </div>
              <span className="font-semibold text-lg tracking-tight">Lexikon</span>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search knowledge..." 
                className="pl-9 bg-background/50 border-border focus-visible:ring-primary"
                onKeyDown={onSearch}
              />
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Knowledge</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/"}>
                      <Link href="/">
                        <Home className="mr-2 h-4 w-4" />
                        <span>Home</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/articles"}>
                      <Link href="/articles">
                        <List className="mr-2 h-4 w-4" />
                        <span>All Articles</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {(user?.role === 'admin' || user?.role === 'editor') && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/templates")}>
                      <Link href="/templates">
                        <LayoutTemplate className="mr-2 h-4 w-4" />
                        <span>Templates</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  )}
                  {user?.role === 'admin' && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/maintenance"}>
                      <Link href="/maintenance">
                        <Wrench className="mr-2 h-4 w-4" />
                        <span>Maintenance</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {user?.role === 'admin' && (
              <SidebarGroup>
                <SidebarGroupLabel>Administration</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location === "/admin"}>
                        <Link href="/admin">
                          <Database className="mr-2 h-4 w-4" />
                          <span>Dashboard</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location === "/admin/users"}>
                        <Link href="/admin/users">
                          <Users className="mr-2 h-4 w-4" />
                          <span>Users</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location === "/admin/groups"}>
                        <Link href="/admin/groups">
                          <Shield className="mr-2 h-4 w-4" />
                          <span>Groups</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location === "/admin/import-export"}>
                        <Link href="/admin/import-export">
                          <Book className="mr-2 h-4 w-4" />
                          <span>Import / Export</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location === "/admin/tokens"}>
                        <Link href="/admin/tokens">
                          <KeyRound className="mr-2 h-4 w-4" />
                          <span>API Keys</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </SidebarContent>
          <SidebarFooter className="p-4">
            <SidebarSeparator className="mb-4" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 overflow-hidden">
                <Avatar className="h-9 w-9 border border-border">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {user?.name?.substring(0, 2).toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col overflow-hidden">
                  <span className="text-sm font-medium truncate">{user?.name}</span>
                  <span className="text-xs text-muted-foreground capitalize">{user?.role}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 mt-4">
              <SidebarMenuButton asChild tooltip="Settings" className="flex-1 justify-center">
                <Link href="/settings">
                  <Settings className="h-4 w-4" />
                </Link>
              </SidebarMenuButton>
              <SidebarMenuButton onClick={handleLogout} tooltip="Log out" className="flex-1 justify-center text-destructive hover:text-destructive hover:bg-destructive/10">
                <LogOut className="h-4 w-4" />
              </SidebarMenuButton>
            </div>
          </SidebarFooter>
        </Sidebar>
        <main className="flex-1 overflow-y-auto bg-background p-6 md:p-8 lg:p-12 relative">
          <div className="max-w-5xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
