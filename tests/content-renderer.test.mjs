import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderContent } from "../dist/content-renderer.js";
test("content preserves rich HTML while removing executable markup and form controls", () => {
  const document = new JSDOM().window.document,
    container = document.createElement("article");
  renderContent(container, {
    name: "<Guide>",
    format: "html",
    body: '<h3>Heading</h3><strong>Bold</strong><script>bad()</script><img src="https://example.com/a.png" onerror="bad()"><a href="javascript:bad()">Link</a><form><input name="token"></form>',
    headerImage: "https://example.com/header.png",
    footerImage: "javascript:bad()",
  });
  assert.equal(container.querySelector("h2").textContent, "<Guide>");
  assert.equal(container.querySelector("strong").textContent, "Bold");
  assert.equal(container.querySelector("script,input,form"), null);
  assert.equal(
    container.querySelector(".content-body img").hasAttribute("onerror"),
    false,
  );
  assert.equal(container.querySelector("a").hasAttribute("href"), false);
  assert.equal(container.querySelectorAll(".content-artwork").length, 1);
});
test("plain content remains literal and rendering replaces the previous page", () => {
  const document = new JSDOM().window.document,
    container = document.createElement("article");
  renderContent(container, {
    name: "One",
    format: "html",
    body: "<b>First</b>",
  });
  renderContent(container, {
    name: "Two",
    format: "text",
    body: "<b>Literal</b>\nNext",
  });
  assert.equal(container.querySelector("b"), null);
  assert.equal(
    container.querySelector(".content-body").textContent,
    "<b>Literal</b>\nNext",
  );
  assert.equal(container.querySelectorAll("h2").length, 1);
});
