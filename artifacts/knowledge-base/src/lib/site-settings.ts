import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface NavLink {
  id: string;
  label: string;
  url: string;
}

export interface SiteSettings {
  siteName: string;
  hasLogo: boolean;
  navLinks: NavLink[];
  logEntriesEnabled: boolean;
  tasksEnabled: boolean;
  projectsEnabled: boolean;
}

export const SITE_SETTINGS_KEY = ["site-settings"] as const;

export function useSiteSettings() {
  return useQuery<SiteSettings>({
    queryKey: SITE_SETTINGS_KEY,
    queryFn: () => fetch("/api/settings").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });
}

export function useInvalidateSiteSettings() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: SITE_SETTINGS_KEY });
}

export const LOGO_URL = "/api/settings/logo";
