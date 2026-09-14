import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const backendUrl = process.env.BACKEND_URL;
const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, ".env.production.local");

if (!backendUrl) {
  console.warn("[write-build-env] BACKEND_URL is not set - skipping; the build will fall back to its default API_BASE.");
  process.exit(0);
}

writeFileSync(outFile, `VITE_API_BASE_URL=${backendUrl}\n`);
console.log(`[write-build-env] wrote ${outFile} (VITE_API_BASE_URL=${backendUrl})`);
