// 실행: npm test
// What dist/ publishes to Naru, which serves nothing under _naru/: the pages
// import none of it, and every page import names a published file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));

async function pages(directory = "") {
  const found = [];
  for (const entry of await readdir(join(dist, directory), {
    withFileTypes: true,
  })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (path !== "_naru") found.push(...(await pages(path)));
    } else if (/\.(m?js|html)$/.test(entry.name))
      // Forward slashes on every system, as the pages' imports name them.
      found.push(path.replaceAll("\\", "/"));
  }
  return found;
}

test("the pages import nothing from _naru/, and every import is published", async () => {
  const files = await pages();
  assert.ok(files.includes("app/names.js"));
  for (const file of files) {
    const source = await readFile(join(dist, file), "utf8");
    for (const [, specifier] of source.matchAll(
      /(?:from\s*|import\s*\(\s*|import\s+)["']((?:\.\.?\/|\/)[^"']+?\.m?js)["']/g,
    )) {
      const target = specifier.startsWith("/")
        ? join(dist, specifier)
        : resolve(dirname(join(dist, file)), specifier);
      assert.ok(
        !target.startsWith(join(dist, "_naru")),
        `${file} imports ${specifier}`,
      );
      assert.ok(existsSync(target), `${file} imports ${specifier}, not built`);
    }
  }
});

test("the modules the pages share are published as Naru runs them", async () => {
  for (const module of ["names.js", "admin-model.js", "admin-models/boards.js"])
    assert.equal(
      await readFile(join(dist, "shared/naru", module), "utf8"),
      await readFile(join(dist, "_naru/modules", module), "utf8"),
    );
});
