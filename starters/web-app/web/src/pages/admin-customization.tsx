import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Paintbrush, Upload, Trash2, Loader2 } from "lucide-react";
import { useSiteSettings, useInvalidateSiteSettings, LOGO_URL, FAVICON_URL } from "@/lib/site-settings";

export default function AdminCustomization() {
  const { data: settings, isLoading } = useSiteSettings();
  const invalidate = useInvalidateSiteSettings();
  const { toast } = useToast();

  // ── Site name ────────────────────────────────────────────────────────────────
  const [siteName, setSiteName] = useState<string>("");
  const displayName = siteName !== "" ? siteName : (settings?.siteName ?? "My App");

  // ── Logo ─────────────────────────────────────────────────────────────────────
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Favicon ───────────────────────────────────────────────────────────────────
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null);
  const [selectedFavicon, setSelectedFavicon] = useState<File | null>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  const [accentColor, setAccentColor] = useState<string | null>(null);
  const activeAccentColor = accentColor ?? settings?.accentColor ?? "#2d534b";


  const saveNameMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteName: name }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Name saved", description: "The site name has been updated." });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("logo", file);
      const res = await fetch("/api/admin/settings/logo", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Logo saved", description: "Your custom logo is now active." });
      setSelectedFile(null);
      setLogoPreview(null);
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeLogoMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/settings/logo", { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to remove");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Logo removed", description: "The default logo has been restored." });
      setSelectedFile(null);
      setLogoPreview(null);
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const uploadFaviconMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("favicon", file);
      const res = await fetch("/api/admin/settings/favicon", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Favicon saved", description: "Your browser tab icon is now active." });
      setSelectedFavicon(null);
      setFaviconPreview(null);
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeFaviconMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/settings/favicon", { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to remove");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Favicon removed", description: "The default browser tab icon has been restored." });
      setSelectedFavicon(null);
      setFaviconPreview(null);
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveAccentColorMutation = useMutation({
    mutationFn: async (color: string) => {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accentColor: color }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Accent color saved", description: "Your brand color is now active across the application." });
      setAccentColor(null);
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleFaviconFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFavicon(file);
    const reader = new FileReader();
    reader.onload = (ev) => setFaviconPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Paintbrush className="h-6 w-6" />
          Customization
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Rebrand the application with your own name, logo, favicon, and accent color.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Site Name */}
        <Card>
          <CardHeader>
            <CardTitle>Site Name</CardTitle>
            <CardDescription>
              Displayed in the top-left of the sidebar and in the browser tab.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="site-name">Name</Label>
              <Input
                id="site-name"
                value={siteName !== "" ? siteName : (settings?.siteName ?? "My App")}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="My App"
                maxLength={100}
              />
            </div>
            <Button
              onClick={() => saveNameMutation.mutate(displayName)}
              disabled={saveNameMutation.isPending}
            >
              {saveNameMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Name
            </Button>
          </CardContent>
        </Card>

        {/* Logo */}
        <Card>
          <CardHeader>
            <CardTitle>Logo</CardTitle>
            <CardDescription>
              Replaces the default icon in the top-left of the sidebar. JPEG, PNG, WebP, or GIF — recommended size 32×32 px or larger square. Maximum 5 MB; SVG is not accepted.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-lg border border-border bg-muted flex items-center justify-center overflow-hidden shrink-0">
                {logoPreview ? (
                  <img src={logoPreview} alt="Preview" className="h-full w-full object-contain" />
                ) : settings?.hasLogo ? (
                  <img
                    src={`${LOGO_URL}?t=${Date.now()}`}
                    alt="Current logo"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="h-9 w-9 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg select-none">
                    {(settings?.siteName ?? "L")[0].toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm text-muted-foreground">
                  {logoPreview
                    ? "Preview — click Save Logo to apply"
                    : settings?.hasLogo
                    ? "Custom logo active"
                    : "Using default icon"}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="mr-2 h-3.5 w-3.5" />
                    {settings?.hasLogo ? "Replace" : "Upload"}
                  </Button>
                  {settings?.hasLogo && !logoPreview && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => removeLogoMutation.mutate()}
                      disabled={removeLogoMutation.isPending}
                    >
                      {removeLogoMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />

            {selectedFile && (
              <div className="flex gap-2">
                <Button
                  onClick={() => uploadLogoMutation.mutate(selectedFile)}
                  disabled={uploadLogoMutation.isPending}
                >
                  {uploadLogoMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Logo
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedFile(null);
                    setLogoPreview(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                >
                  Cancel
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Accent color */}
        <Card>
          <CardHeader>
            <CardTitle>Accent Color</CardTitle>
            <CardDescription>
              Used for primary buttons, links, active controls, and other brand accents in both light and dark modes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <label
                htmlFor="accent-color"
                className="h-14 w-14 rounded-lg border border-border cursor-pointer shadow-inner"
                style={{ backgroundColor: activeAccentColor }}
                title="Choose accent color"
              />
              <div className="flex-1 space-y-2">
                <Label htmlFor="accent-color">Brand color</Label>
                <div className="flex items-center gap-3">
                  <input
                    id="accent-color"
                    type="color"
                    value={activeAccentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="sr-only"
                  />
                  <span className="font-mono text-sm uppercase">{activeAccentColor}</span>
                  <Button
                    onClick={() => saveAccentColorMutation.mutate(activeAccentColor)}
                    disabled={saveAccentColorMutation.isPending}
                  >
                    {saveAccentColorMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Color
                  </Button>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Choose a color swatch to preview it immediately. Text contrast adjusts automatically for readability.
            </p>
          </CardContent>
        </Card>

        {/* Favicon */}
        <Card>
          <CardHeader>
            <CardTitle>Favicon</CardTitle>
            <CardDescription>
              The small icon shown in browser tabs. Use a PNG, GIF, or ICO file up to 1 MB.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-lg border border-border bg-muted flex items-center justify-center overflow-hidden shrink-0">
                {faviconPreview ? (
                  <img src={faviconPreview} alt="Favicon preview" className="h-8 w-8 object-contain" />
                ) : settings?.hasFavicon ? (
                  <img
                    src={`${FAVICON_URL}?v=${encodeURIComponent(settings.faviconVersion ?? "")}`}
                    alt="Current favicon"
                    className="h-8 w-8 object-contain"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">Default</span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm text-muted-foreground">
                  {faviconPreview
                    ? "Preview — click Save Favicon to apply"
                    : settings?.hasFavicon
                    ? "Custom favicon active"
                    : "Using default favicon"}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => faviconInputRef.current?.click()}>
                    <Upload className="mr-2 h-3.5 w-3.5" />
                    {settings?.hasFavicon ? "Replace" : "Upload"}
                  </Button>
                  {settings?.hasFavicon && !faviconPreview && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => removeFaviconMutation.mutate()}
                      disabled={removeFaviconMutation.isPending}
                    >
                      {removeFaviconMutation.isPending
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <input
              ref={faviconInputRef}
              type="file"
              accept="image/png,image/gif,image/x-icon,.ico"
              className="hidden"
              onChange={handleFaviconFileChange}
            />
            {selectedFavicon && (
              <div className="flex gap-2">
                <Button
                  onClick={() => uploadFaviconMutation.mutate(selectedFavicon)}
                  disabled={uploadFaviconMutation.isPending}
                >
                  {uploadFaviconMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Favicon
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedFavicon(null);
                    setFaviconPreview(null);
                    if (faviconInputRef.current) faviconInputRef.current.value = "";
                  }}
                >
                  Cancel
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Sidebar Preview</CardTitle>
          <CardDescription>How the top-left of the sidebar will look.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-sidebar px-3 py-2">
            <div className="h-8 w-8 rounded overflow-hidden flex items-center justify-center shrink-0">
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" className="h-full w-full object-contain" />
              ) : settings?.hasLogo ? (
                <img
                  src={`${LOGO_URL}?t=${Date.now()}`}
                  alt="Logo"
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="h-8 w-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold">
                  {displayName[0]?.toUpperCase() ?? "L"}
                </div>
              )}
            </div>
            <span className="font-semibold text-lg tracking-tight">{displayName}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
