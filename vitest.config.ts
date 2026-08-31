import { defineConfig } from 'vitest/config'
import path from 'path'
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'client/src'), '@shared': path.resolve(__dirname, 'shared') } },
  test: {
    environment: 'node',
    include: ['client/src/**/*.test.ts', 'api/**/*.test.ts', 'shared/**/*.test.ts'],
    // Dummy Supabase env so tests can import modules that transitively pull
    // client/src/lib/supabase.ts (createClient throws without a URL). No test
    // performs network I/O against these.
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      // api/mcp/_lib.ts signs consent state with the service key and refuses to
      // fall back to a constant, so the MCP tests need one present.
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    },
  },
})
