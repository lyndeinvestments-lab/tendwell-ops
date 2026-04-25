import type { Express } from "express";
import { createServer, type Server } from "http";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { handleChat } from "./chat";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // CORS configuration
  app.use(cors({
    origin: process.env.NODE_ENV === "production"
      ? process.env.CORS_ORIGIN || false
      : true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }));

  // Stricter rate limit for the chat endpoint — each request calls the Claude API.
  app.use("/api/chat", rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many chat requests, please wait a few minutes." },
  }));

  // General /api rate limit: 100 req per 15-minute window per IP.
  app.use("/api", rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  }));

  // ── Chat endpoint ──────────────────────────────────────────────────────────
  // Accepts: POST /api/chat { messages: [{role, content}], token: string }
  // Returns: { message: string }
  // The token is the caller's Supabase access_token; tools are filtered to
  // only what the user's role permits, and writes require admin role.
  app.post("/api/chat", handleChat);

  return httpServer;
}
