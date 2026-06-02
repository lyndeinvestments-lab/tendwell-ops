import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  // Stamp the service worker with a per-build hash so CACHE_NAME rotates on
  // every deploy. The activate handler already purges caches whose name
  // doesn't match — combined, this means each deploy auto-evicts old caches.
  // Best-effort: a missing file or absent placeholder is logged but does
  // not fail the build.
  try {
    const swPath = "dist/public/sw.js";
    const sw = await readFile(swPath, "utf-8");
    const hash = String(Date.now()).slice(-10);
    if (sw.includes("__BUILD_HASH__")) {
      await writeFile(swPath, sw.replaceAll("__BUILD_HASH__", hash));
      console.log(`stamped sw.js with build hash ${hash}`);
    } else {
      console.warn("sw.js did not contain __BUILD_HASH__ placeholder; cache name unchanged");
    }
  } catch (e) {
    console.warn("could not stamp sw.js:", (e as Error).message);
  }

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
