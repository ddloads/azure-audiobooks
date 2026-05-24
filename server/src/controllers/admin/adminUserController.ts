import prisma from "../../lib/prisma";
import bcrypt from "bcryptjs";
import { Response } from "express";
import { AuthRequest } from "../../middleware/authMiddleware";
import { createLogger } from "../../lib/logger";
import {
  findUserByEmailInsensitive,
  findUserByUsernameInsensitive,
  isValidEmail,
  sanitizeEmail,
  sanitizeUsername,
} from "../../utils/usernames";
import {
  getSingleParam,
  getSingleBodyValue,
} from "./shared";

const adminLogger = createLogger("admin");

export const listUsers = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { progress: true } },
      },
      orderBy: [{ role: "asc" }, { username: "asc" }],
    });

    res.json(users);
  } catch (error) {
    console.error("List users error:", error);
    res.status(500).json({ error: "Failed to load users" });
  }
};

export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { password, role } = req.body as {
      password?: string;
      role?: string;
    };
    const username = sanitizeUsername(req.body?.username);
    const email = sanitizeEmail(req.body?.email);

    if (!username || !email || !password) {
      res.status(400).json({ error: "Username, email, and password are required" });
      return;
    }

    if (!isValidEmail(email)) {
      res.status(400).json({ error: "A valid email is required" });
      return;
    }

    const normalizedRole = role === "ADMIN" ? "ADMIN" : "USER";
    const existingUser = await findUserByUsernameInsensitive(username);
    if (existingUser) {
      res.status(400).json({ error: "Username already exists" });
      return;
    }

    const existingEmail = await findUserByEmailInsensitive(email);
    if (existingEmail) {
      res.status(400).json({ error: "Email already exists" });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        role: normalizedRole,
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(201).json(user);
    adminLogger.info("User created", {
      targetUserId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    });
  } catch (error) {
    console.error("Create user error:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
};

export const updateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = getSingleParam(req.params.userId);
    if (!userId) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    const { role, password } = req.body as { role?: string; password?: string };
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const data: { role?: string; password?: string } = {};

    if (role) {
      const normalizedRole = role === "ADMIN" ? "ADMIN" : "USER";
      if (user.role === "ADMIN" && normalizedRole !== "ADMIN") {
        const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
        if (adminCount <= 1) {
          res.status(400).json({ error: "At least one admin account is required" });
          return;
        }
      }

      data.role = normalizedRole;
    }

    if (password) {
      data.password = await bcrypt.hash(password, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json(updatedUser);
    adminLogger.info("User updated", {
      targetUserId: updatedUser.id,
      username: updatedUser.username,
      role: updatedUser.role,
      passwordChanged: Boolean(password),
    });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = getSingleParam(req.params.userId);
    if (!userId) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    if (req.user?.userId === userId) {
      res.status(400).json({ error: "You cannot delete your own account" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (user.role === "ADMIN") {
      const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
      if (adminCount <= 1) {
        res.status(400).json({ error: "At least one admin account is required" });
        return;
      }
    }

    await prisma.user.delete({ where: { id: userId } });
    adminLogger.warn("User deleted", {
      targetUserId: user.id,
      username: user.username,
      role: user.role,
    });
    res.status(204).send();
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
};
