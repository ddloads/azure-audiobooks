const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const getConfiguredApiBaseUrl = () => {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  return configured ? trimTrailingSlash(configured) : null;
};

export const getApiBaseUrl = () => getConfiguredApiBaseUrl() || "/api";

export const getSocketBaseUrl = () => {
  const configured = getConfiguredApiBaseUrl();
  if (!configured) {
    return undefined;
  }

  return configured.endsWith("/api") ? configured.slice(0, -4) : configured;
};
