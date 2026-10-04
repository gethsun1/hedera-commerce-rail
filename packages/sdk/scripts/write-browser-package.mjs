import { writeFile } from "node:fs/promises";

await writeFile(
  new URL("../dist/browser/package.json", import.meta.url),
  `${JSON.stringify({ type: "module" }, null, 2)}\n`,
);
