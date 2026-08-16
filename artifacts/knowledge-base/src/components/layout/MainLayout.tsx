import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useLogout } from "@workspace/api-client-react";
import { useTheme } from "@/lib/theme";
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
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Book,
  Tag,
  Home,
  Settings,
  Users,
  Shield,
  Database,
  LogOut,
  KeyRound,
  LayoutTemplate,
  ShieldCheck,
  Paintbrush,
  Sun,
  Moon,
  ExternalLink,
  BookOpen,
  Library,
  ListTodo,
  FolderKanban,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSiteSettings, LOGO_URL } from "@/lib/site-settings";

export function MainLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const logout = useLogout();
  const { data: siteSettings } = useSiteSettings();
  const { theme, setTheme } = useTheme();

  const siteName = siteSettings?.siteName ?? "Memex";
  const hasLogo = siteSettings?.hasLogo ?? false;

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        setLocation("/login");
        window.location.reload();
      },
    });
  };

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <Sidebar className="border-r border-border bg-sidebar">
          <SidebarHeader className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded overflow-hidden flex items-center justify-center shrink-0">
                {hasLogo ? (
                  <img
                    src={LOGO_URL}
                    alt={siteName}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="h-8 w-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold">
                    {siteName[0]?.toUpperCase() ?? "L"}
                  </div>
                )}
              </div>
              <span className="font-semibold text-lg tracking-tight">{siteName}</span>
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
                    <SidebarMenuButton
                      asChild
                      isActive={location.startsWith("/knowledge")}
                    >
                      <Link href="/knowledge">
                        <Library className="mr-2 h-4 w-4" />
                        <span>Knowledge</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {siteSettings?.logEntriesEnabled && (
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location === "/log"}>
                        <Link href="/log">
                          <BookOpen className="mr-2 h-4 w-4" />
                          <span>Logs</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  {siteSettings?.tasksEnabled !== false && (
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location.startsWith("/tasks")}>
                        <Link href="/tasks">
                          <ListTodo className="mr-2 h-4 w-4" />
                          <span>Tasks</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  {siteSettings?.projectsEnabled !== false && (
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location.startsWith("/projects")}>
                        <Link href="/projects">
                          <FolderKanban className="mr-2 h-4 w-4" />
                          <span>Projects</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  {(user?.role === "admin" || user?.role === "editor") && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        isActive={location.startsWith("/templates")}
                      >
                        <Link href="/templates">
                          <LayoutTemplate className="mr-2 h-4 w-4" />
                          <span>Templates</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {(siteSettings?.navLinks ?? []).length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel>Links</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {(siteSettings?.navLinks ?? []).map((link) => (
                      <SidebarMenuItem key={link.id}>
                        <SidebarMenuButton asChild>
                          <a href={link.url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="mr-2 h-4 w-4" />
                            <span>{link.label}</span>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {user?.role === "admin" && (
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
                      <SidebarMenuButton
                        asChild
                        isActive={location === "/admin/users"}
                      >
                        <Link href="/admin/users">
                          <Users className="mr-2 h-4 w-4" />
                          <span>Users</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        isActive={location === "/admin/groups"}
                      >
                        <Link href="/admin/groups">
                          <Shield className="mr-2 h-4 w-4" />
                          <span>Groups</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        isActive={location === "/admin/import-export"}
                      >
                        <Link href="/admin/import-export">
                          <Book className="mr-2 h-4 w-4" />
                          <span>Import / Export</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        isActive={location === "/admin/tokens"}
                      >
                        <Link href="/admin/tokens">
                          <KeyRound className="mr-2 h-4 w-4" />
                          <span>API Keys</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        isActive={location === "/admin/sso"}
                      >
                        <Link href="/admin/sso">
                          <ShieldCheck className="mr-2 h-4 w-4" />
                          <span>SSO / Identity</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        isActive={location === "/admin/customization"}
                      >
                        <Link href="/admin/customization">
                          <Paintbrush className="mr-2 h-4 w-4" />
                          <span>Customization</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        isActive={location === "/admin/tags"}
                      >
                        <Link href="/admin/tags">
                          <Tag className="mr-2 h-4 w-4" />
                          <span>Tags</span>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 w-full rounded-md px-2 py-1.5 hover:bg-accent transition-colors overflow-hidden">
                  <Avatar className="h-9 w-9 border border-border shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {user?.name?.substring(0, 2).toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col overflow-hidden text-left">
                    <span className="text-sm font-medium truncate">{user?.name}</span>
                    <span className="text-xs text-muted-foreground capitalize">
                      {user?.role}
                    </span>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-52">
                <DropdownMenuItem asChild>
                  <Link
                    href="/settings"
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Settings className="h-4 w-4" />
                    Settings &amp; Password
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={toggleTheme}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  {theme === "dark" ? (
                    <Sun className="h-4 w-4" />
                  ) : (
                    <Moon className="h-4 w-4" />
                  )}
                  {theme === "dark" ? "Light mode" : "Dark mode"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="flex items-center gap-2 text-destructive focus:text-destructive cursor-pointer"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>

        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Mobile-only top bar */}
          <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0">
            <SidebarTrigger className="h-8 w-8" />
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="h-6 w-6 rounded overflow-hidden flex items-center justify-center shrink-0">
                {hasLogo ? (
                  <img
                    src={LOGO_URL}
                    alt={siteName}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="h-6 w-6 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold text-xs">
                    {siteName[0]?.toUpperCase() ?? "L"}
                  </div>
                )}
              </div>
              <span className="font-semibold truncate">{siteName}</span>
            </div>
            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent transition-colors shrink-0"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
          </header>

          <main className="flex-1 overflow-y-auto bg-background p-6 md:p-8 lg:p-12 relative">
            <div className="max-w-5xl mx-auto w-full">{children}</div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
