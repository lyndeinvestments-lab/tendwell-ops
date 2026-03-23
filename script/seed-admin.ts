/**
 * Seed an admin user with a properly bcrypt-hashed password.
 *
 * Usage:
 *   npx tsx script/seed-admin.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars (or .env file).
 */
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcrypt'

const ADMIN_LABEL = 'Admin'
const ADMIN_PASSWORD = 'admin123'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function main() {
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 12)

  const { error } = await supabase.from('app_users').insert({
    label: ADMIN_LABEL,
    role: 'admin',
    password_hash: hash,
    allowed_views: [],
  })

  if (error) {
    // If duplicate, try updating instead
    if (error.code === '23505') {
      const { error: updateErr } = await supabase
        .from('app_users')
        .update({ password_hash: hash })
        .eq('label', ADMIN_LABEL)
        .eq('role', 'admin')

      if (updateErr) {
        console.error('Failed to update admin password:', updateErr.message)
        process.exit(1)
      }
      console.log(`Updated admin password for "${ADMIN_LABEL}"`)
    } else {
      console.error('Failed to create admin user:', error.message)
      process.exit(1)
    }
  } else {
    console.log(`Created admin user "${ADMIN_LABEL}" with password "${ADMIN_PASSWORD}"`)
  }

  console.log('Done. You can now log in and change the password from Settings.')
}

main()
