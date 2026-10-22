import { Link } from "wouter";
import { Settings, Users, Shield, Paintbrush, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { useSiteSettings } from "@/lib/site-settings";

const ADMIN_LINKS = [
  { href: "/admin/users", label: "Users", icon: Users, text: "Create accounts and assign roles." },
  { href: "/admin/groups", label: "Groups", icon: Shield, text: "Organize users into groups." },
  { href: "/admin/sso", label: "SSO / Identity", icon: ShieldCheck, text: "Connect SAML or OIDC providers." },
  { href: "/admin/customization", label: "Customization", icon: Paintbrush, text: "Name, logo, favicon and accent color." },
];

export default function Home() {
  const { user } = useAuth();
  const { data: settings } = useSiteSettings();
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary" data-testid="text-welcome">
          Welcome{user?.name ? `, ${user.name}` : ""}
        </h1>
        <p className="text-muted-foreground mt-2">You are signed in to {settings?.siteName ?? "My App"}.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/settings" data-testid="link-home-settings">
          <Card className="h-full transition-colors hover:bg-accent/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Settings className="h-4 w-4" />Settings</CardTitle>
              <CardDescription>Manage your account and password.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        {user?.role === "admin" && ADMIN_LINKS.map(({ href, label, icon: Icon, text }) => (
          <Link key={href} href={href} data-testid={`link-home-${label.toLowerCase()}`}>
            <Card className="h-full transition-colors hover:bg-accent/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Icon className="h-4 w-4" />{label}</CardTitle>
                <CardDescription>{text}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
