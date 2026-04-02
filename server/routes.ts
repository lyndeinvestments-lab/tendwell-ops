import type { Express } from "express";
import { createServer, type Server } from "http";
import cors from "cors";

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

  // All auth is handled via Google OAuth through Supabase Auth.
  // All data access goes client → Supabase directly with RLS enforcement.
  // No Express API endpoints are needed for application data.

  return httpServer;
}
