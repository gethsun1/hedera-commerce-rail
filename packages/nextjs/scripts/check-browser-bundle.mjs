import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../.next/static/", import.meta.url);
const forbidden = [
  "@hiero-ledger/sdk",
  "HEDERA_PRIVATE_KEY",
  "createHederaClient",
  "HEDERA_ACCOUNT_ID",
  "node:fs",
  "node:crypto",
  "internal/hcs/publisher",
];
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(entry => (entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)])),
    )
  ).flat();
}
const assets = (await files(root.pathname)).filter(path => path.endsWith(".js"));
if (!assets.length)
  throw new Error("No production browser JavaScript bundles found. Run the Next.js production build first.");
const hits = [];
for (const file of assets) {
  const source = await readFile(file, "utf8");
  for (const marker of forbidden) if (source.includes(marker)) hits.push(`${file}: ${marker}`);
}
if (hits.length) throw new Error(`Server-only dependency leaked into browser bundle:\n${hits.join("\n")}`);
console.log(`Browser bundle scan passed (${assets.length} JavaScript assets).`);
