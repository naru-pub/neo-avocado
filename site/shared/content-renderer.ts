import createDOMPurify, { type DOMPurify } from "../vendor/purify.es.mjs";

const sanitizers = new WeakMap<Window, DOMPurify>();
/** Sanitized HTML as a fragment: no scripts, forms or page-global style/id/name. */
export function sanitizedFragment(
  document: Document,
  html: string | null | undefined,
) {
  const window = document.defaultView as Window & typeof globalThis;
  let sanitizer = sanitizers.get(window);
  if (!sanitizer) {
    sanitizer = createDOMPurify(window);
    sanitizers.set(window, sanitizer);
  }
  return sanitizer.sanitize(html ?? "", {
    USE_PROFILES: { html: true },
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ["style", "form", "input", "button", "select", "textarea"],
    FORBID_ATTR: ["style", "id", "name"],
  });
}
/** A content page (content/pages), as its renderer reads it. */
export interface ContentPage {
  name: string;
  format?: string;
  body?: string | null;
  headerImage?: string | null;
  footerImage?: string | null;
}
export function renderContent(container: HTMLElement, page: ContentPage) {
  const document = container.ownerDocument;
  container.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = page.name;
  container.append(heading);
  const artwork = (url: string | null | undefined) => {
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password)
        return;
    } catch {
      return;
    }
    const image = document.createElement("img");
    image.src = url;
    image.alt = "";
    image.className = "content-artwork";
    container.append(image);
  };
  artwork(page.headerImage);
  const body = document.createElement("div");
  body.className = "content-body";
  if (page.format === "html") {
    body.append(sanitizedFragment(document, page.body));
  } else {
    body.classList.add("plain-content");
    body.textContent = page.body ?? "";
  }
  container.append(body);
  artwork(page.footerImage);
}
