import { useState } from "react";
import { 
  useListUsers, 
  getListUsersQueryKey, 
  useCreateUser, 
  useUpdateUser, 
  useDeleteUser,
  type User,
  type UserUpdate,
  type UserUpdateRole,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Edit, Trash2, ShieldAlert } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

const ROLES = ["user", "editor", "admin"] as const;
type RoleValue = typeof ROLES[number];

export default function AdminUsers() {
  const { data: users, isLoading } = useListUsers();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const deleteMutation = useDeleteUser();
  const { data: providers, isError: providerError, isLoading: providersLoading } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["auth-providers"],
    queryFn: async () => {
      const response = await fetch("/api/auth/providers");
      if (!response.ok) throw new Error("Unable to check configured SSO providers.");
      return response.json();
    },
    staleTime: 0,
  });

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "user" as RoleValue,
    ssoOnly: false,
  });

  const handleOpenDialog = (user?: User) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        name: user.name,
        email: user.email,
        password: "",
        role: user.role as RoleValue,
        ssoOnly: user.ssoOnly,
      });
    } else {
      setEditingUser(null);
      setFormData({ name: "", email: "", password: "", role: "user", ssoOnly: false });
    }
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    const needsPassword = !formData.ssoOnly && (!editingUser || editingUser.ssoOnly || !!formData.password);
    if (!formData.name.trim() || !formData.email.trim()) {
      toast({ title: "Check the user details", description: "Name and email are required.", variant: "destructive" });
      return;
    }
    if (needsPassword && formData.password.length < 8) {
      toast({ title: "New password required", description: "Supply a new password of at least 8 characters to enable password sign-in.", variant: "destructive" });
      return;
    }
    if (editingUser) {
      const updateData: UserUpdate = {
        name: formData.name,
        email: formData.email,
        role: formData.role as UserUpdateRole,
        ssoOnly: formData.ssoOnly,
      };
      if (!formData.ssoOnly && formData.password) {
        updateData.password = formData.password;
      }
      updateMutation.mutate({ id: editingUser.id, data: updateData }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          toast({ title: "User updated" });
          setIsDialogOpen(false);
        },
        onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      });
    } else {
      createMutation.mutate({ data: { name: formData.name, email: formData.email, password: formData.ssoOnly ? undefined : formData.password, role: formData.role, ssoOnly: formData.ssoOnly } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          toast({ title: "User created" });
          setIsDialogOpen(false);
        },
        onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      });
    }
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast({ title: "User deleted" });
      },
      onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
    });
  };

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Users</h1>
          <p className="text-muted-foreground mt-1">Manage platform access and roles.</p>
        </div>
        <Button onClick={() => handleOpenDialog()} data-testid="button-create-user">
          <Plus className="mr-2 h-4 w-4" />
          Add User
        </Button>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? "Edit User" : "Create User"}</DialogTitle>
            <DialogDescription>Choose the user's role and whether they sign in with a password or single sign-on.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[65vh] overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="user-name">Name</Label>
              <Input
                id="user-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="jane@example.com"
                type="email"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={formData.role}
                onValueChange={(v: RoleValue) => setFormData({ ...formData, role: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox id="user-sso-only" checked={formData.ssoOnly} onCheckedChange={(checked) => setFormData({ ...formData, ssoOnly: checked === true, password: "" })} />
                <Label htmlFor="user-sso-only">SSO Only</Label>
              </div>
              <p className="text-xs text-muted-foreground">Enabling SSO Only removes password sign-in and local password recovery. This account must use a configured SSO provider with a matching email identity.</p>
              {formData.ssoOnly && (
                providersLoading ? <p className="text-xs text-muted-foreground">Checking SSO providers…</p> :
                providerError ? <p role="alert" className="text-xs text-destructive">Could not verify whether an SSO provider is enabled. Check SSO configuration before removing password sign-in.</p> :
                !providers?.length ? <p role="alert" className="text-xs text-destructive">No SSO provider is enabled. This account will not be able to sign in until an administrator enables a matching provider.</p> : null
              )}
            </div>
            {!formData.ssoOnly && <div className="space-y-2">
              <Label htmlFor="user-password">{editingUser?.ssoOnly ? "New Password (required to enable password sign-in)" : editingUser ? "New Password (leave blank to keep current)" : "Password"}</Label>
              <Input
                id="user-password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                type="password"
              />
              {editingUser?.ssoOnly && <p className="text-xs text-muted-foreground">A new password of at least 8 characters is required. Previous passwords are never reactivated.</p>}
            </div>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground bg-muted/50 uppercase">
                <tr>
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Role</th>
                  <th className="px-6 py-3 font-medium">Joined</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users?.map((user) => (
                  <tr key={user.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-foreground">{user.name}</div>
                      {user.ssoOnly && <Badge variant="outline" className="mt-1">SSO Only</Badge>}
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge
                        variant={user.role === "admin" ? "default" : user.role === "editor" ? "secondary" : "outline"}
                        className="capitalize"
                      >
                        {user.role === "admin" && <ShieldAlert className="w-3 h-3 mr-1" />}
                        {user.role}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {format(new Date(user.createdAt), "MMM d, yyyy")}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" aria-label={`Edit ${user.name}`} onClick={() => handleOpenDialog(user)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete User</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete {user.name}? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(user.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
