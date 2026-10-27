import { createHash, randomBytes } from "crypto";
import prisma from "../lib/prisma";

export const INVITE_MIN_DAYS = 1;
export const INVITE_MAX_DAYS = 30;
export const INVITE_NOTE_MAX = 120;

export const hashInviteToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates an invite and returns its raw token. The token is never stored, so this is the only time it exists. */
export const createInvite = async (options: { note?: string | null; expiresInDays: number; createdById: string }) => {
  const token = randomBytes(24).toString("base64url");
  const invite = await prisma.invite.create({
    data: {
      tokenHash: hashInviteToken(token),
      note: options.note || null,
      createdById: options.createdById,
      expiresAt: new Date(Date.now() + options.expiresInDays * 24 * 60 * 60 * 1000),
    },
  });
  return { invite, token };
};

/** The invite for a raw token, if it is unused and not expired. */
export const findUsableInvite = async (token: unknown) => {
  if (typeof token !== "string" || token.length < 16 || token.length > 128) return null;
  return prisma.invite.findFirst({
    where: { tokenHash: hashInviteToken(token), usedAt: null, expiresAt: { gt: new Date() } },
  });
};
