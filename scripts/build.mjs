// Builds the site Naru publishes, site/, into dist/: each TypeScript file
// compiled to JavaScript at the same path, beside the pages, styles,
// vendored libraries and the _naru folder's other files as they are.

import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Biome } from "@biomejs/js-api/nodejs";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
// What Naru publishes is site/; the rest is the repository's.
const site = join(root, "site");
const out = join(root, "dist");

// The compiled JavaScript is formatted as the sources are (biome.json's
// formatter settings), for owners who read what their site serves.
const { formatter, javascript } = JSON.parse(
  await readFile(join(root, "biome.json"), "utf8"),
);
const biome = new Biome();
const { projectKey } = biome.openProject(root);
biome.applyConfiguration(projectKey, { formatter, javascript });
const format = (content, filePath) =>
  biome.formatContent(projectKey, content, { filePath }).content;

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
      await writeFile(published, format(outputText, published));
    } else if (!/\.[^./]+$/.test(entry.name))
      // Naru serves files by extension: LICENSE and the like go as .txt.
      await cp(join(site, path), `${target}.txt`);
    else await cp(join(site, path), target);
  }
}

// The pages import some of the site's code from _naru/modules/ (the owner's
// names, places, images, the admin model), which Naru keeps private: it
// serves nothing under _naru/. So those modules, and what they import, are
// published again in shared/naru/, at the same paths, and the pages' imports
// point there. The sources keep one copy, beside the code that runs on Naru.
const MODULES = "_naru/modules/";
const PUBLISHED = "shared/naru/";
const SPECIFIER = /(["'])((?:\.\.?\/)+|\/)_naru\/modules\/([^"']+?\.js)\1/g;
const RELATIVE = /(["'])(\.\.?\/[^"']+?\.js)\1/g;

async function files(directory) {
  const found = [];
  for (const entry of await readdir(join(out, directory), {
    withFileTypes: true,
  })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await files(path)));
    else if (/\.(m?js|html)$/.test(entry.name)) found.push(path);
  }
  return found;
}

async function publishPageModules() {
  const needed = new Set();
  for (const path of await files("")) {
    if (path.startsWith("_naru/")) continue;
    const source = await readFile(join(out, path), "utf8");
    const published = source.replace(SPECIFIER, (_, quote, up, module) => {
      needed.add(module);
      return `${quote}${up}${PUBLISHED}${module}${quote}`;
    });
    if (published !== source) await writeFile(join(out, path), published);
  }
  const queue = [...needed];
  while (queue.length) {
    const module = queue.pop();
    const source = await readFile(join(out, MODULES, module), "utf8");
    for (const [, , specifier] of source.matchAll(RELATIVE)) {
      const imported = relative(
        join(out, MODULES),
        join(out, MODULES, dirname(module), specifier),
      );
      if (imported.startsWith(".."))
        throw new Error(
          `${MODULES}${module}, which the pages import, imports ${specifier} from outside ${MODULES}.`,
        );
      if (!needed.has(imported)) {
        needed.add(imported);
        queue.push(imported);
      }
    }
  }
  for (const module of needed) {
    await mkdir(dirname(join(out, PUBLISHED, module)), { recursive: true });
    await cp(join(out, MODULES, module), join(out, PUBLISHED, module));
  }
  return needed.size;
}

await rm(out, { recursive: true, force: true });
await build("");
console.log(`${await publishPageModules()} module(s) published for the pages`);
// The license goes with the code it covers (GPL-3.0), as LICENSE.txt: Naru
// serves files by extension.
await cp(join(root, "LICENSE"), join(out, "LICENSE.txt"));
console.log(`built ${relative(process.cwd(), out) || out}`);
