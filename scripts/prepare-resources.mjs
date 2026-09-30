/**
 * Prepares Tauri resource bundle after `next build`:
 *   1. Copy .next/standalone/ → src-tauri/resources/standalone/
 *   2. Copy public/ and .next/static/ into the standalone tree
 *   3. Create a clean template SQLite database with migrations + seeded AppConfig
 */

import { cp, rm, mkdir, access } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RESOURCES = join(ROOT, "src-tauri", "resources");
const STANDALONE_SRC = join(ROOT, ".next", "standalone");
const STANDALONE_DEST = join(RESOURCES, "standalone");
const TEMPLATE_DB = join(RESOURCES, "template.db");
const TEMPLATE_DB_URL = `file:${TEMPLATE_DB}`;

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ── 1. Clean and recreate resources/ ─────────────────────────────────────────
console.log("🧹  Cleaning src-tauri/resources/ ...");
await rm(RESOURCES, { recursive: true, force: true });
await mkdir(RESOURCES, { recursive: true });

// ── 2. Copy standalone output ─────────────────────────────────────────────────
if (!(await exists(STANDALONE_SRC))) {
  console.error("❌  .next/standalone not found — did `next build` run?");
  process.exit(1);
}
console.log("📦  Copying .next/standalone/ ...");
await cp(STANDALONE_SRC, STANDALONE_DEST, { recursive: true });

// ── 3. Copy public/ into standalone/public/ ───────────────────────────────────
const publicSrc = join(ROOT, "public");
if (await exists(publicSrc)) {
  console.log("🗂️   Copying public/ ...");
  await cp(publicSrc, join(STANDALONE_DEST, "public"), { recursive: true });
}

// ── 4. Copy .next/static/ into standalone/.next/static/ ──────────────────────
const staticSrc = join(ROOT, ".next", "static");
if (await exists(staticSrc)) {
  console.log("📂  Copying .next/static/ ...");
  await cp(staticSrc, join(STANDALONE_DEST, ".next", "static"), {
    recursive: true,
  });
}

// ── 5. Create template database ───────────────────────────────────────────────
console.log("🗄️   Creating template database ...");

// Remove any stale template
await rm(TEMPLATE_DB, { force: true });

execSync("npx prisma migrate deploy", {
  cwd: ROOT,
  env: { ...process.env, DATABASE_URL: TEMPLATE_DB_URL },
  stdio: "inherit",
});

execSync("npx tsx scripts/seed-template-db.ts", {
  cwd: ROOT,
  env: { ...process.env, SEED_DATABASE_URL: TEMPLATE_DB_URL },
  stdio: "inherit",
});

console.log("✅  Resources prepared successfully.");
