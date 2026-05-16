import { useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQuery } from "@tanstack/react-query";
import { useLogin } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldCheck } from "lucide-react";

interface SsoProvider {
  id: number;
  name: string;
  provider: "saml" | "oidc";
}

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const SSO_ERRORS: Record<string, string> = {
  saml_config: "SAML provider is misconfigured. Contact your administrator.",
  saml_failed: "SAML authentication failed. Please try again.",
  saml_no_email: "SAML provider did not return an email address.",
  oidc_config: "OIDC provider is misconfigured. Contact your administrator.",
  oidc_failed: "OIDC authentication failed. Please try again.",
  oidc_no_email: "OIDC provider did not return an email address.",
  oidc_state: "SSO session expired. Please try again.",
};

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const login = useLogin();

  // Show SSO error from redirect params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err && SSO_ERRORS[err]) {
      toast({ title: "SSO Error", description: SSO_ERRORS[err], variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [toast]);

  const { data: providers = [] } = useQuery<SsoProvider[]>({
    queryKey: ["auth-providers"],
    queryFn: () => fetch("/api/auth/providers").then((r) => r.json()),
    staleTime: 60_000,
  });

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = (data: LoginFormValues) => {
    login.mutate({ data }, {
      onSuccess: () => {
        setLocation("/");
        window.location.reload();
      },
      onError: (error) => {
        toast({
          title: "Login failed",
          description: error.message || "Please check your credentials and try again.",
          variant: "destructive",
        });
      },
    });
  };

  const handleSso = (p: SsoProvider) => {
    window.location.href = `/api/auth/${p.provider}/${p.id}/login`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
      <div className="absolute top-[-10%] right-[-5%] w-96 h-96 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-5%] w-72 h-72 bg-primary/5 rounded-full blur-3xl pointer-events-none" />

      <Card className="w-full max-w-md relative z-10 border-border shadow-md">
        <CardHeader className="space-y-3 text-center pb-6 pt-8">
          <div className="mx-auto h-12 w-12 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl mb-2">
            L
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Welcome to Lexikon</CardTitle>
          <CardDescription>
            Enter your credentials to access the knowledge base.
          </CardDescription>
        </CardHeader>

        <CardContent className="pb-8 space-y-5">
          {/* SSO buttons */}
          {providers.length > 0 && (
            <div className="space-y-2">
              {providers.map((p) => (
                <Button
                  key={p.id}
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => handleSso(p)}
                >
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Sign in with {p.name}
                </Button>
              ))}
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or sign in with email</span>
                </div>
              </div>
            </div>
          )}

          {/* Local login form */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="name@example.com" type="email" autoComplete="email" data-testid="input-email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input placeholder="••••••••" type="password" autoComplete="current-password" data-testid="input-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={login.isPending} data-testid="button-login">
                {login.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Sign in
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
