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
  const matches = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "User"
    WHERE lower(username) = ${normalized}
    ORDER BY "createdAt" ASC
    LIMIT 1
  `;

  const userId = matches[0]?.id;
  if (!userId) {
    return null;
  }

  return prisma.user.findUnique({ where: { id: userId } });
};

export const findUserByEmailInsensitive = async (email: string) => {
  const normalized = email.trim().toLowerCase();
  const matches = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "User"
    WHERE lower(email) = ${normalized}
    ORDER BY "createdAt" ASC
    LIMIT 1
  `;

  const userId = matches[0]?.id;
  if (!userId) {
    return null;
  }

  return prisma.user.findUnique({ where: { id: userId } });
};
