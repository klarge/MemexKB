import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface SiteSettings {
  siteName: string;
  hasLogo: boolean;
  hasFavicon: boolean;
  faviconMimeType: string | null;
  faviconVersion: string | null;
  accentColor: string | null;
}

export const SITE_SETTINGS_KEY = ["site-settings"] as const;

export function useSiteSettings() {
  return useQuery<SiteSettings>({
    queryKey: SITE_SETTINGS_KEY,
    queryFn: async () => {
      const r = await fetch("/api/settings", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load settings");
      return r.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useInvalidateSiteSettings() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: SITE_SETTINGS_KEY });
}

export const LOGO_URL = "/api/settings/logo";
export const FAVICON_URL = "/api/settings/favicon";
