import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

// Live RLS posture check against the real Supabase project. Kept out of
// `npm test` because it needs network access and the project URL + anon key;
// run it with `npm run test:rls`. Only the public (browser-shipped) values are
// used -- never the service-role key, since that bypasses the RLS under test.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.live.test.ts"],
    env: loadEnv("", process.cwd(), "NEXT_PUBLIC_SUPABASE_"),
  },
});
