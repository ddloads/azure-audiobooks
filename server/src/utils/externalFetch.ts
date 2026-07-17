const DEFAULT_EXTERNAL_FETCH_TIMEOUT_MS = 20_000;

const getExternalFetchTimeoutMs = () => {
  const configured = Number.parseInt(process.env.EXTERNAL_FETCH_TIMEOUT_MS || "", 10);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_EXTERNAL_FETCH_TIMEOUT_MS;
};

export const fetchExternal = (url: string, init: RequestInit = {}) =>
  fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(getExternalFetchTimeoutMs()),
  });
