import { readFile } from "node:fs/promises";
import { analyze } from "../dist/index.js";
const load = async (name) =>
  JSON.parse(await readFile(new URL(name, import.meta.url), "utf8"));
console.log(
  JSON.stringify(
    analyze(await load("./scan.json"), await load("./catalog.json")),
    null,
    2,
  ),
);
