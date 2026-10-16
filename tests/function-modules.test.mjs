import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

// The pages call site functions by "<module/path>:<export>", as the SDK takes
// them. Every such reference must name a function a module exports, and every
// callable export must be one the pages call.
const pages = [
  "app.js",
  "admin.js",
  "admin-titles.js",
  ...(await readdir(new URL("../dist/app", import.meta.url))).map(
    (file) => `app/${file}`,
  ),
];
const references = new Set();
for (const page of pages) {
  const source = await readFile(
    new URL(`../dist/${page}`, import.meta.url),
    "utf8",
  );
  for (const [, reference] of source.matchAll(
    /"((?:community|economy|characters|content)\/[a-z]+:[A-Za-z]+)"/g,
  ))
    references.add(reference);
}

const modules = [];
for (const group of ["community", "economy", "characters", "content"])
  for (const file of await readdir(
    new URL(`../dist/_naru/functions/${group}`, import.meta.url),
  ))
    modules.push(`${group}/${file.replace(/\.js$/, "")}`);

for (const module of modules)
  test(`${module} exports only functions the pages call`, async () => {
    const path = new URL(
      `../dist/_naru/functions/${module}.js`,
      import.meta.url,
    );
    const exports = await import(path.href);
    const { readOnly = [], visitors = [], ...callable } = exports;
    const names = Object.keys(callable).sort();
    assert.ok(names.every((name) => typeof exports[name] === "function"));
    assert.deepEqual(
      names.filter((name) => !references.has(`${module}:${name}`)),
      [],
    );
    // What Naru runs read-only or for visitors must be one of its functions.
    assert.ok(readOnly.every((name) => names.includes(name)));
    assert.ok(visitors.every((name) => names.includes(name)));
    const source = await readFile(path, "utf8");
    assert.match(source, /from "\.\.\/\.\.\/modules\/shared\.js"/);
  });

test("every function the pages call exists", () => {
  const known = new Set();
  return Promise.all(
    modules.map(async (module) => {
      const exports = await import(
        new URL(`../dist/_naru/functions/${module}.js`, import.meta.url).href
      );
      for (const [name, value] of Object.entries(exports))
        if (typeof value === "function") known.add(`${module}:${name}`);
    }),
  ).then(() =>
    assert.deepEqual(
      [...references].filter((reference) => !known.has(reference)),
      [],
    ),
  );
});
