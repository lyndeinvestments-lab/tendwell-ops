import type { Express } from "express";
import { createServer, type Server } from "http";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = 'https://eetsudoksvsmwtiqraot.supabase.co'
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVldHN1ZG9rc3ZzbXd0aXFyYW90Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDAyMTEzOSwiZXhwIjoyMDg5NTk3MTM5fQ.Ago83AfkFavkZSsSPaRaK-2z7OOG0p2qJRFawGLDVPw'

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

// View access map per role
const ROLE_VIEWS: Record<string, string[]> = {
  admin: ['dashboard', 'pipeline', 'quote-sheet', 'cost-tracking', 'property-list', 'linen-tracker', 'access-codes', 'ac-filters', 'master-list', 'pro-forma'],
  operations: ['property-list', 'linen-tracker', 'access-codes', 'ac-filters'],
  cleaning: ['linen-tracker'],
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.post("/api/auth/login", async (req, res) => {
    const { password } = req.body
    if (!password) {
      return res.status(400).json({ error: "Password required" })
    }

    try {
      const { data, error } = await supabaseAdmin
        .from('app_users')
        .select('role, label, password_hash')
        .eq('password_hash', password)
        .single()

      if (error || !data) {
        return res.status(401).json({ error: "Invalid password" })
      }

      const allowedViews = ROLE_VIEWS[data.role] || []
      return res.json({
        role: data.role,
        label: data.label,
        allowedViews,
      })
    } catch (err) {
      console.error('Auth error:', err)
      return res.status(500).json({ error: "Server error" })
    }
  })

  return httpServer;
}
