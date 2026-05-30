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
import {
  errorLoggingMiddleware,
  requestLoggingMiddleware,
} from "./middleware/loggingMiddleware";

const app = express();
app.set("trust proxy", 1);
const allowedOrigins = new Set(
  (process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const isAllowedDevOrigin = (origin: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/i.test(
    origin,
  );

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin) || isAllowedDevOrigin(origin)) {
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

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use(errorLoggingMiddleware);

export default app;
