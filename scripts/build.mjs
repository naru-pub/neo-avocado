// Builds the site Naru publishes, site/, into dist/: each TypeScript file
// compiled to JavaScript at the same path, beside the pages, styles,
// vendored libraries and the _naru folder's other files as they are.
import ts from "typescript";
import { format } from "prettier";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// What Naru publishes is site/; the rest is the repository's.
const site = join(root, "site");
const out = join(root, "dist");

async function build(directory) {
  for (const entry of await readdir(join(site, directory), {
    withFileTypes: true,
  })) {
    const path = join(directory, entry.name);
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
      const source = await readFile(join(site, path), "utf8");
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
    } else if (!/\.[^./]+$/.test(entry.name))
      // Naru serves files by extension: LICENSE and the like go as .txt.
      await cp(join(site, path), `${target}.txt`);
    else await cp(join(site, path), target);
  }
}

await rm(out, { recursive: true, force: true });
await build("");
// The license goes with the code it covers (GPL-3.0), as LICENSE.txt: Naru
// serves files by extension.
await cp(join(root, "LICENSE"), join(out, "LICENSE.txt"));
console.log(`built ${relative(process.cwd(), out) || out}`);
