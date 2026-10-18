import { readFile, writeFile, mkdir } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const sources = {
  "purify.es.mjs": "dist/purify.es.mjs",
  "DOMPurify-LICENSE": "LICENSE",
  "DOMPurify-LICENSE-MPL": "LICENSE-MPL",
};
await mkdir(new URL("site/vendor/", root), { recursive: true });
for (const [target, source] of Object.entries(sources)) {
  let bytes = await readFile(
    new URL(`node_modules/dompurify/${source}`, root),
    "utf8",
  );
  if (target.endsWith(".mjs"))
    bytes = bytes.replace(/^\/\/# sourceMappingURL=.*$/m, "");
  const path = new URL(`site/vendor/${target}`, root);
  if (process.argv.includes("--check")) {
    if ((await readFile(path, "utf8")) !== bytes)
      throw new Error(`${target} is stale; run npm run vendor:content`);
  } else await writeFile(path, bytes);
}
