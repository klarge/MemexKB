import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, Key, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type AdminToken = {
  id: number;
  name: string;
  userId: number;
  userName: string | null;
  userEmail: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

function fetchAdminTokens(): Promise<AdminToken[]> {
  return fetch("/api/admin/tokens").then((r) => {
    if (!r.ok) throw new Error("Failed to load tokens");
    return r.json();
  });
}

function revokeAdminToken(id: number): Promise<void> {
  return fetch(`/api/admin/tokens/${id}`, { method: "DELETE" }).then((r) => {
    if (!r.ok) throw new Error("Failed to revoke token");
  });
}

function tokenStatus(token: AdminToken): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
    return { label: "Expired", variant: "destructive" };
  }
  if (token.lastUsedAt) return { label: "Active", variant: "default" };
  return { label: "Never used", variant: "outline" };
}

export default function AdminTokens() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tokens, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-tokens"],
    queryFn: fetchAdminTokens,
  });

  const revokeMutation = useMutation({
    mutationFn: revokeAdminToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-tokens"] });
      toast({ title: "Token revoked" });
    },
    onError: (err) => toast({ title: "Error", description: (err as Error).message, variant: "destructive" }),
  });

  const [filterUser, setFilterUser] = useState("");

  const filtered = tokens?.filter((t) => {
    if (!filterUser) return true;
    const q = filterUser.toLowerCase();
    return (
      t.userName?.toLowerCase().includes(q) ||
      t.userEmail?.toLowerCase().includes(q)
    );
  });

  const userCount = new Set(tokens?.map((t) => t.userId)).size;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">API Keys</h1>
          <p className="text-muted-foreground mt-1">
            All active API keys across{" "}
            <span className="font-medium text-foreground">{userCount}</span>{" "}
            {userCount === 1 ? "user" : "users"} — {tokens?.length ?? 0} total
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Filter */}
      <div className="flex gap-2 max-w-sm">
        <input
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="Filter by user name or email…"
          value={filterUser}
          onChange={(e) => setFilterUser(e.target.value)}
        />
        {filterUser && (
          <Button variant="ghost" size="sm" onClick={() => setFilterUser("")}>
            Clear
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            {!filtered || filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <Key className="h-10 w-10 opacity-30" />
                <p className="text-sm">
                  {filterUser ? "No tokens match your filter." : "No API keys have been created yet."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-muted-foreground bg-muted/50 uppercase">
                    <tr>
                      <th className="px-6 py-3 font-medium">Token Name</th>
                      <th className="px-6 py-3 font-medium">Owner</th>
                      <th className="px-6 py-3 font-medium">Status</th>
                      <th className="px-6 py-3 font-medium">Created</th>
                      <th className="px-6 py-3 font-medium">Last Used</th>
                      <th className="px-6 py-3 font-medium">Expires</th>
                      <th className="px-6 py-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((token) => {
                      const status = tokenStatus(token);
                      return (
                        <tr
                          key={token.id}
                          className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-6 py-4 font-medium text-foreground">
                            <div className="flex items-center gap-2">
                              <Key className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              {token.name}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-medium">{token.userName ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{token.userEmail ?? ""}</div>
                          </td>
                          <td className="px-6 py-4">
                            <Badge variant={status.variant}>{status.label}</Badge>
                          </td>
                          <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
                            {format(new Date(token.createdAt), "MMM d, yyyy")}
                          </td>
                          <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
                            {token.lastUsedAt
                              ? formatDistanceToNow(new Date(token.lastUsedAt), { addSuffix: true })
                              : "—"}
                          </td>
                          <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
                            {token.expiresAt
                              ? format(new Date(token.expiresAt), "MMM d, yyyy")
                              : "Never"}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  disabled={revokeMutation.isPending}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Revoke <strong>{token.name}</strong> belonging to{" "}
                                    <strong>{token.userName ?? token.userEmail ?? "this user"}</strong>?
                                    Any integrations using it will stop working immediately.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => revokeMutation.mutate(token.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Revoke
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
