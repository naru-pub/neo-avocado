import test from "node:test";
import assert from "node:assert/strict";
import { FUNCTION_MODULES, functionReference } from "../function-references.js";
import { readFile } from "node:fs/promises";
for (const module of new Set(Object.values(FUNCTION_MODULES))) {
  test(`${module} exposes exactly its registered callable functions`, async () => {
    const path = new URL(`../_naru/functions/${module}.js`, import.meta.url);
    const source = await readFile(path, "utf8");
    const exports = await import(path.href);
    const names = Object.keys(FUNCTION_MODULES)
      .filter((name) => FUNCTION_MODULES[name] === module)
      .sort();
    const { readOnly = [], visitors = [], ...callable } = exports;
    assert.deepEqual(Object.keys(callable).sort(), names);
    // What Naru runs read-only must be one of the module's own functions.
    assert.ok(readOnly.every((name) => names.includes(name)));
    assert.ok(visitors.every((name) => names.includes(name)));
    assert.ok(names.every((name) => typeof exports[name] === "function"));
    assert.match(source, /from "\.\.\/\.\.\/modules\/shared\.js"/);
    for (const name of names)
      assert.equal(functionReference(name), `${module}:${name}`);
  });
}
test("unknown or inherited names cannot become client function references", () => {
  for (const name of ["missing", "constructor", "__proto__", "toString"])
    assert.throws(() => functionReference(name), TypeError);
});
