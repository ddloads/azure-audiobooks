const DEFAULT_DEV_CLIENT_ORIGIN = "http://localhost:5173";
const INSECURE_JWT_SECRETS = new Set([
  "super-secret-key-change-me",
  "development-only-jwt-secret-change-me-before-production",
]);
const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32;

export const getNodeEnv = (env: NodeJS.ProcessEnv = process.env) => env.NODE_ENV || "development";

export const isProduction = (env: NodeJS.ProcessEnv = process.env) => getNodeEnv(env) === "production";

export const getJwtSecret = (env: NodeJS.ProcessEnv = process.env): string => {
  const raw = env.JWT_SECRET?.trim();

  if (raw && !INSECURE_JWT_SECRETS.has(raw)) {
    if (isProduction(env) && raw.length < MIN_PRODUCTION_JWT_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET must be at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters in production`,
      );
    }
    return raw;
  }

  if (isProduction(env)) {
    throw new Error(
      "JWT_SECRET is required in production and must not use the insecure default value",
    );
  }

  return "development-only-jwt-secret-change-me-before-production";
};

export const getAllowedOrigins = (env: NodeJS.ProcessEnv = process.env): Set<string> => {
  const rawOrigins = env.CLIENT_ORIGIN?.trim();
  if (!rawOrigins && isProduction(env)) {
    return new Set();
  }

  return new Set(
    (rawOrigins || DEFAULT_DEV_CLIENT_ORIGIN)
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
};

export const isAllowedDevOrigin = (origin: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/i.test(
    origin,
  );

export const isOriginAllowed = (
  origin: string | undefined,
  allowedOrigins = getAllowedOrigins(),
  nodeEnv = getNodeEnv(),
) => {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  return nodeEnv !== "production" && isAllowedDevOrigin(origin);
};
