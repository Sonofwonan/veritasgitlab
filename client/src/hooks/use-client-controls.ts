import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_CLIENT_FEATURE_FLAGS,
  DEFAULT_CLIENT_NOTICE,
  DEFAULT_PLATFORM_SETTINGS,
  resolveEffectiveFeatures,
  type EffectiveClientControls,
} from "@shared/client-controls";

export const CLIENT_CONTROLS_QUERY_KEY = ["/api/client/controls"] as const;

const DEFAULT_CONTROLS: EffectiveClientControls = {
  platform: DEFAULT_PLATFORM_SETTINGS,
  features: DEFAULT_CLIENT_FEATURE_FLAGS,
  notice: DEFAULT_CLIENT_NOTICE,
  effective: resolveEffectiveFeatures(DEFAULT_PLATFORM_SETTINGS, DEFAULT_CLIENT_FEATURE_FLAGS),
};

export function useClientControls() {
  const query = useQuery<EffectiveClientControls>({
    queryKey: CLIENT_CONTROLS_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/client/controls", { credentials: "include" });
      if (!res.ok) return DEFAULT_CONTROLS;
      return res.json();
    },
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const data = query.data ?? DEFAULT_CONTROLS;
  return {
    ...query,
    controls: data,
    platform: data.platform,
    features: data.effective,
    rawFeatures: data.features,
    notice: data.notice,
  };
}
