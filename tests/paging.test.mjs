import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

// app/core.js wires the page's elements as it loads.
const { window } = new JSDOM(
  await readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
);
globalThis.document = window.document;
globalThis.window = window;
const { cursorPages } = await import("../dist/app/core.js");

/** A list of `count` documents read by cursor, recording each read. */
function list(count) {
  const reads = [];
  const read = async (after, { includeTotal, size, cursorOnly }) => {
    reads.push({ after, size, cursorOnly: Boolean(cursorOnly) });
    const from = after === null ? 0 : Number(after);
    const documents = Array.from(
      { length: Math.max(0, Math.min(size, count - from)) },
      (_, n) => ({ id: String(from + n) }),
    );
    const next = from + size < count ? String(from + size) : null;
    return cursorOnly
      ? { nextCursor: next }
      : {
          documents,
          nextCursor: next,
          ...(includeTotal ? { totalCount: count } : {}),
        };
  };
  return { reads, read };
}

test("a page past the end is empty, without reading the pages before it", async () => {
  const { reads, read } = list(25);
  const pages = cursorPages(read, 10);
  const page = await pages.page(999_999);
  assert.deepEqual(page.documents, []);
  assert.equal(reads.length, 1); // the first page, for the total
});

test("a far page is reached ten pages a read, keeping only cursors", async () => {
  const { reads, read } = list(1000);
  const pages = cursorPages(read, 10);
  const page = await pages.page(57);
  assert.equal(page.number, 57);
  assert.equal(page.documents[0].id, "560");
  // The first page, five skips (to 12, 22, 32, 42, 52), one to 57, then it.
  assert.equal(reads.length, 8);
  assert.ok(
    reads.slice(1, -1).every((step) => step.cursorOnly && step.size <= 100),
  );
  // Pages nearby are known now.
  reads.length = 0;
  assert.equal((await pages.page(58)).documents[0].id, "570");
  assert.equal(reads.length, 1);
});

test("a bigger page size skips fewer pages a read, within 100 documents", async () => {
  const { reads, read } = list(1000);
  const pages = cursorPages(read, 20);
  assert.equal((await pages.page(12)).documents[0].id, "220");
  assert.ok(reads.every((step) => step.size <= 100));
});
