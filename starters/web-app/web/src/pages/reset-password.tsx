import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function ResetPassword() {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) {
      toast({ title: "Recovery link missing", description: "Ask an administrator for a new recovery link.", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch("/api/auth/recovery/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not reset password.");
      toast({ title: "Password set", description: "You can now sign in with your new password." });
      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      toast({ title: "Password could not be set", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Set a new password</CardTitle>
          <CardDescription>Use the one-time recovery link supplied by your administrator.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input id="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input id="confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} required />
            </div>
            <Button className="w-full" disabled={isSaving} type="submit">{isSaving ? "Saving…" : "Set password"}</Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground"><Link href="/login">Back to sign in</Link></p>
        </CardContent>
      </Card>
    </main>
  );
}