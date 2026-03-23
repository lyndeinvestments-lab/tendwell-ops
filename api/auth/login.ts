import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ROLE_VIEWS: Record<string, string[]> = {
  admin: ['dashboard', 'pipeline', 'quote-sheet', 'cost-tracking', 'property-list', 'linen-tracker', 'access-codes', 'ac-filters', 'master-list', 'pro-forma', 'previous-properties', 'settings'],
  operations: ['property-list', 'linen-tracker', 'access-codes', 'ac-filters'],
  cleaning: ['linen-tracker'],
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  const { password } = req.body || {};

  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  try {
    const { data: users, error } = await supabaseAdmin
      .from('app_users')
      .select('role, label, password_hash');

    if (error || !users) {
      console.error('Supabase query error:', error);
      return res.status(401).json({ error: 'Invalid password' });
    }

    let matchedUser = null;
    for (const user of users) {
      if (user.password_hash && await bcrypt.compare(password, user.password_hash)) {
        matchedUser = user;
        break;
      }
    }

    if (!matchedUser) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const allowedViews = ROLE_VIEWS[matchedUser.role] || [];

    return res.json({
      role: matchedUser.role,
      label: matchedUser.label,
      allowedViews,
    });
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
