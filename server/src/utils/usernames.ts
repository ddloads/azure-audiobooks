import prisma from "../lib/prisma";

export const normalizeUsername = (username: string) => username.trim().toLowerCase();

export const sanitizeUsername = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const sanitizeEmail = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed ? trimmed : null;
};

export const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const findUserByUsernameInsensitive = async (username: string) => {
  const normalized = normalizeUsername(username);
  return prisma.user.findFirst({
    where: {
      username: {
        equals: normalized,
        mode: "insensitive",
      },
    },
    orderBy: { createdAt: "asc" },
  });
};

export const findUserByEmailInsensitive = async (email: string) => {
  const normalized = email.trim().toLowerCase();
  return prisma.user.findFirst({
    where: {
      email: {
        equals: normalized,
        mode: "insensitive",
      },
    },
    orderBy: { createdAt: "asc" },
  });
};
