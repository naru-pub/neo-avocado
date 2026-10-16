import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { emoticonParts, emoticonContent } from "../dist/emoticons.js";
const definitions = [
  { id: "a", data: { name: ":smile:", image: "https://example.com/a.png" } },
  { id: "b", data: { name: ":smile:big", image: "https://example.com/b.png" } },
];
test("emoticon replacement is literal, chooses longest keywords and never reparses generated images", () => {
  assert.deepEqual(emoticonParts("Hi :smile:big :smile:", definitions), [
    { text: "Hi " },
    { image: "https://example.com/b.png", keyword: ":smile:big" },
    { text: " " },
    { image: "https://example.com/a.png", keyword: ":smile:" },
  ]);
  assert.deepEqual(
    emoticonParts("[.*]", [
      { id: "x", data: { name: "[.*]", image: "https://example.com/x.png" } },
    ]),
    [{ image: "https://example.com/x.png", keyword: "[.*]" }],
  );
});
test("emoticon rendering preserves plain markup and rejects unsafe image URLs", () => {
  const document = new JSDOM().window.document;
  const container = document.createElement("div");
  container.append(
    emoticonContent(document, "<script>bad()</script> :smile: unsafe", [
      ...definitions,
      { id: "x", data: { name: "unsafe", image: "javascript:alert(1)" } },
    ]),
  );
  assert.equal(container.querySelector("script"), null);
  assert.equal(container.querySelectorAll("img").length, 1);
  assert.equal(container.querySelector("img").alt, ":smile:");
  assert.match(container.textContent, /<script>bad\(\)<\/script>/);
  assert.match(container.textContent, /unsafe/);
});
