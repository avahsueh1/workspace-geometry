import { readFile, stat } from "node:fs/promises";
import { analyze } from "../dist/index.js";
const [scanPath, catalogPath] = process.argv.slice(2);
if (!scanPath || !catalogPath) {
  console.error("Usage: node scripts/match.mjs scan.json catalog.json");
  process.exit(1);
}
async function load(path) {
  if ((await stat(path)).size > 32_000_000)
    throw new Error("JSON input exceeds 32 MB");
  return JSON.parse(await readFile(path, "utf8"));
}
try {
  console.log(
    JSON.stringify(
      analyze(await load(scanPath), await load(catalogPath)),
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
