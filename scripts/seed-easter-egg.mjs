// One-time seeder for the easter-egg marker photos.
//
// Usage:
//   EASTER_EGG_SEED_SECRET=your-secret \
//   EASTER_EGG_BASE_URL=https://your-app.vercel.app \
//   node scripts/seed-easter-egg.mjs /path/to/marc.png /path/to/nicolas.png
//
// - EASTER_EGG_SEED_SECRET must match the env var set on your deployment.
// - The images are only read from your local disk and POSTed straight to
//   Redis through the API route — they're never added to the repo or any
//   commit.
// - Safe to re-run any time you want to swap the photos.

import { readFile } from "node:fs/promises";
import path from "node:path";

const [marcPath, nicolasPath] = process.argv.slice(2);
const secret = process.env.EASTER_EGG_SEED_SECRET;
const baseUrl = process.env.EASTER_EGG_BASE_URL ?? "http://localhost:3000";

if (!marcPath || !nicolasPath) {
  console.error("Usage: node scripts/seed-easter-egg.mjs <marc.png> <nicolas.png>");
  process.exit(1);
}

if (!secret) {
  console.error("Set EASTER_EGG_SEED_SECRET to match the value configured on your deployment.");
  process.exit(1);
}

function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

async function toDataUrl(filePath) {
  const buffer = await readFile(filePath);
  return `data:${guessMime(filePath)};base64,${buffer.toString("base64")}`;
}

const [marc, nicolas] = await Promise.all([toDataUrl(marcPath), toDataUrl(nicolasPath)]);

const response = await fetch(`${baseUrl}/api/easter-egg`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ secret, marc, nicolas }),
});

if (!response.ok) {
  const text = await response.text();
  console.error(`Seed failed (${response.status}): ${text}`);
  process.exit(1);
}

console.log("Easter egg images seeded to Redis.");
