// Builds the site Naru publishes into dist/: each TypeScript file compiled
// to JavaScript at the same path, beside the pages, styles, vendored
// libraries and the _naru folder's other files as they are.
import ts from "typescript";
import { format } from "prettier";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "dist");
// What stays in the repository: tooling, tests and sources' own settings.
const SKIP = new Set([
  ".git",
  ".github",
  "dist",
  "node_modules",
  "scripts",
  "tests",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  ".prettierrc",
  ".prettierignore",
  ".gitignore",
]);

async function build(directory) {
  for (const entry of await readdir(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = join(directory, entry.name);
    if (!directory && SKIP.has(entry.name)) continue;
    if (entry.isDirectory()) {
      await build(path);
      continue;
    }
    const target = join(out, path);
    await mkdir(dirname(target), { recursive: true });
    if (entry.name.endsWith(".d.ts")) continue;
    if (entry.name.endsWith(".ts")) {
      // Types removed and nothing else: comments and layout stay, so the
      // published files read as the sources do.
      const source = await readFile(join(root, path), "utf8");
      const { outputText } = ts.transpileModule(source, {
        fileName: path,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          removeComments: false,
          verbatimModuleSyntax: false,
        },
      });
      const published = target.replace(/\.ts$/, ".js");
      await writeFile(
        published,
        await format(outputText, { filepath: published }),
      );
    } else await cp(join(root, path), target);
  }
}

await rm(out, { recursive: true, force: true });
await build("");
console.log(`built ${relative(process.cwd(), out) || out}`);
