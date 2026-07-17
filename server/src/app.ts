import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes";
import libraryRoutes from "./routes/libraryRoutes";
import uploadRoutes from "./routes/uploadRoutes";
import streamRoutes from "./routes/streamRoutes";
import progressRoutes from "./routes/progressRoutes";
import settingsRoutes from "./routes/settingsRoutes";
import adminRoutes from "./routes/adminRoutes";
import reportRoutes from "./routes/reportRoutes";
import recommendationRoutes from "./routes/recommendationRoutes";
import authorRoutes from "./routes/authorRoutes";
import sessionRoutes from "./routes/sessionRoutes";
import bookmarkRoutes from "./routes/bookmarkRoutes";
import mobileAppRoutes from "./routes/mobileAppRoutes";
import {
  errorLoggingMiddleware,
  requestLoggingMiddleware,
} from "./middleware/loggingMiddleware";
import { getAllowedOrigins, isOriginAllowed } from "./utils/securityConfig";
import prisma from "./lib/prisma";

const app = express();
app.set("trust proxy", 1);
const allowedOrigins = getAllowedOrigins();

app.use(
  cors({
    origin(origin, callback) {
      if (isOriginAllowed(origin, allowedOrigins)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(requestLoggingMiddleware);

app.use("/api/auth", authRoutes);
app.use("/api/library", libraryRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/stream", streamRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/recommendations", recommendationRoutes);
app.use("/api/authors", authorRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/bookmarks", bookmarkRoutes);
app.use("/api/mobile-app", mobileAppRoutes);

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});

app.use(errorLoggingMiddleware);

export default app;
