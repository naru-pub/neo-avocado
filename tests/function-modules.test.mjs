import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

// The pages call site functions, queries and mutations by
// "<module/path>:<export>", as the SDK takes them. Every such reference must
// name a function a module exports, and every callable export must be one
// the pages call.
const pages = [
  "admin/main.js",
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
    /"((?:community|economy|characters|content|admin)\/[a-z_]+:[A-Za-z]+)"/g,
  ))
    references.add(reference);
}

// The admin's section calls, which admin.js makes from
// modules/admin-calls.js rather than writes out.
const calls = await import(
  new URL("../dist/_naru/modules/admin-calls.js", import.meta.url).href
);
for (const section of [
  ...Object.keys(calls.RECORD_CALLS),
  ...Object.keys(calls.OWN_CALLS),
  ...calls.SETTINGS_SECTIONS,
])
  for (const call of ["list", "get", "save", "remove"]) {
    const name = calls.adminCall(section, call);
    if (name) references.add(name);
  }

/** Each module of a folder (functions, queries, mutations), by area. */
async function modulesOf(folder) {
  const found = [];
  const root = new URL(`../dist/_naru/${folder}/`, import.meta.url);
  for (const group of await readdir(root).catch(() => []))
    for (const file of await readdir(new URL(`${group}/`, root)))
      found.push(`${group}/${file.replace(/\.js$/, "")}`);
  return found;
}
const folders = {
  functions: await modulesOf("functions"),
  queries: await modulesOf("queries"),
  mutations: await modulesOf("mutations"),
};

for (const [folder, modules] of Object.entries(folders))
  for (const module of modules)
    test(`${folder}/${module} exports only functions the pages call`, async () => {
      const path = new URL(
        `../dist/_naru/${folder}/${module}.js`,
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
      if (folder !== "functions") {
        // Queries and mutations have no such lists: their code decides.
        assert.equal(exports.readOnly, undefined);
        assert.equal(exports.visitors, undefined);
        return;
      }
      // What Naru runs read-only or for visitors must be one of its functions.
      assert.ok(readOnly.every((name) => names.includes(name)));
      assert.ok(visitors.every((name) => names.includes(name)));
      const source = await readFile(path, "utf8");
      assert.match(
        source,
        /from "\.\.\/\.\.\/modules\/(shared|members|access)\.js"/,
      );
    });

test("every function, query and mutation the pages call exists", async () => {
  const known = new Set();
  for (const [folder, modules] of Object.entries(folders))
    for (const module of modules) {
      const exports = await import(
        new URL(`../dist/_naru/${folder}/${module}.js`, import.meta.url).href
      );
      for (const [name, value] of Object.entries(exports))
        if (typeof value === "function") known.add(`${module}:${name}`);
    }
  assert.deepEqual(
    [...references].filter((reference) => !known.has(reference)),
    [],
  );
});
