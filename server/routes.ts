import type { Express } from "express";
import { createServer, type Server } from "http";
import { createClient } from "@supabase/supabase-js";
import rateLimit from "express-rate-limit";
import bcrypt from "bcrypt";
import cors from "cors";

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

// View access map per role
const ROLE_VIEWS: Record<string, string[]> = {
  admin: ['dashboard', 'pipeline', 'quote-sheet', 'cost-tracking', 'property-list', 'linen-tracker', 'access-codes', 'ac-filters', 'master-list', 'pro-forma', 'previous-properties', 'settings'],
  operations: ['property-list', 'linen-tracker', 'access-codes', 'ac-filters'],
  cleaning: ['linen-tracker'],
}

// Rate limit login: max 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
})

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

  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    const { password } = req.body
    if (!password) {
      return res.status(400).json({ error: "Password required" })
    }

    try {
      // Fetch all users and compare password hashes securely server-side
      const { data: users, error } = await supabaseAdmin
        .from('app_users')
        .select('role, label, password_hash')

      if (error || !users) {
        return res.status(401).json({ error: "Invalid password" })
      }

      // Compare supplied password against each stored bcrypt hash
      let matchedUser = null
      for (const user of users) {
        if (user.password_hash && await bcrypt.compare(password, user.password_hash)) {
          matchedUser = user
          break
        }
      }

      if (!matchedUser) {
        return res.status(401).json({ error: "Invalid password" })
      }

      const allowedViews = ROLE_VIEWS[matchedUser.role] || []
      return res.json({
        role: matchedUser.role,
        label: matchedUser.label,
        allowedViews,
      })
    } catch (err) {
      console.error('Auth error:', err)
      return res.status(500).json({ error: "Server error" })
    }
  })

  // Create user with bcrypt-hashed password (admin only — validated by RLS or caller)
  app.post("/api/auth/create-user", async (req, res) => {
    const { label, role, password } = req.body
    if (!label || !role || !password) {
      return res.status(400).json({ error: "label, role, and password are required" })
    }
    try {
      const hash = await bcrypt.hash(password, 12)
      const { error } = await supabaseAdmin.from('app_users').insert({
        label,
        role,
        password_hash: hash,
        allowed_views: [],
      })
      if (error) {
        return res.status(500).json({ error: error.message })
      }
      return res.json({ ok: true })
    } catch (err) {
      console.error('Create user error:', err)
      return res.status(500).json({ error: "Server error" })
    }
  })

  return httpServer;
}
