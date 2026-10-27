import prisma from "../../lib/prisma";
import { Response } from "express";
import { AuthRequest } from "../../middleware/authMiddleware";
import { INVITE_MAX_DAYS, INVITE_MIN_DAYS, INVITE_NOTE_MAX, createInvite } from "../../utils/invites";

const inviteStatus = (invite: { usedAt: Date | null; expiresAt: Date }) =>
  invite.usedAt ? "used" : invite.expiresAt <= new Date() ? "expired" : "active";

/** Invites from the last 30 days plus any still active, newest first, with usernames resolved. */
export const listInvites = async (_req: AuthRequest, res: Response) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const invites = await prisma.invite.findMany({
      where: { OR: [{ createdAt: { gte: since } }, { usedAt: null, expiresAt: { gt: new Date() } }] },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const userIds = [...new Set(invites.flatMap((invite) => [invite.createdById, invite.usedById]).filter(Boolean))] as string[];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } });
    const usernames = new Map(users.map((user) => [user.id, user.username]));

    res.json(
      invites.map((invite) => ({
        id: invite.id,
        note: invite.note,
        status: inviteStatus(invite),
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
        usedAt: invite.usedAt,
        createdBy: invite.createdById ? usernames.get(invite.createdById) ?? null : null,
        usedBy: invite.usedById ? usernames.get(invite.usedById) ?? null : null,
      })),
    );
  } catch (error) {
    res.status(500).json({ error: "Failed to load invites" });
  }
};

export const createInviteHandler = async (req: AuthRequest, res: Response) => {
  try {
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, INVITE_NOTE_MAX) : null;
    const days = Number(req.body?.expiresInDays ?? 7);
    if (!Number.isInteger(days) || days < INVITE_MIN_DAYS || days > INVITE_MAX_DAYS) {
      res.status(400).json({ error: `expiresInDays must be a whole number from ${INVITE_MIN_DAYS} to ${INVITE_MAX_DAYS}` });
      return;
    }

    const { invite, token } = await createInvite({ note, expiresInDays: days, createdById: req.user!.userId });
    // The client builds the link from its own origin; the token is only ever returned here.
    res.status(201).json({ id: invite.id, token, expiresAt: invite.expiresAt });
  } catch (error) {
    res.status(500).json({ error: "Failed to create invite" });
  }
};

export const revokeInvite = async (req: AuthRequest, res: Response) => {
  try {
    const result = await prisma.invite.deleteMany({ where: { id: String(req.params.id), usedAt: null } });
    if (result.count === 0) {
      res.status(404).json({ error: "Invite not found or already used" });
      return;
    }
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: "Failed to revoke invite" });
  }
};
