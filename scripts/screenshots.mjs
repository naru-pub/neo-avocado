// Screenshots of the running community (neo-avocado.naru.pub, as a visitor
// sees it) for the landing page, into landing/screenshots/ (each at a
// desktop width and, as name-mobile.jpg, a phone's; light, and as
// name-dark.jpg, dark, as the site follows the system), and the template's
// preview on Naru's board into docs/ (1280×960, the size of Naru's own
// previews), which the workflow publishes with the template.
//
//   PLAYWRIGHT_MODULE=…/playwright/index.mjs node scripts/screenshots.mjs [origin]
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);

const origin = process.argv[2] ?? "https://neo-avocado.naru.pub";
const root = fileURLToPath(new URL("../", import.meta.url));
const out = join(root, "landing/screenshots");
await mkdir(out, { recursive: true });

/** Pages a visitor reaches, and what to scroll to first (null: the top). */
const PAGES = [
  { name: "entrance", path: "/", scroll: null, entrance: false },
  { name: "home", path: "/home", scroll: null },
  { name: "members", path: "/members", scroll: null },
  { name: "character", path: "/character/1", scroll: null },
  { name: "log", path: "/post/1", scroll: "text=No. 1" },
  { name: "content", path: "/content", scroll: null },
];
const MOBILE = new Set(["members", "log"]);

const browser = await chromium.launch();
try {
  for (const colorScheme of ["light", "dark"])
    for (const [size, options] of [
      ["", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }],
      [
        "-mobile",
        {
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
        },
      ],
    ]) {
      const suffix = `${size}${colorScheme === "dark" ? "-dark" : ""}`;
      const context = await browser.newContext({
        ...options,
        colorScheme,
        locale: "ko-KR",
      });
      const page = await context.newPage();
      // The entrance (cf_intro) shows once a visit: pass it before the pages
      // behind it.
      await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      if (size === "")
        await page.screenshot({
          path: join(out, `entrance${suffix}.jpg`),
          type: "jpeg",
          quality: 82,
        });
      await page.getByText("들어가기", { exact: true }).click();
      await page.waitForLoadState("networkidle");
      for (const shot of PAGES) {
        if (shot.entrance === false) continue;
        if (size && !MOBILE.has(shot.name)) continue;
        await page.goto(`${origin}${shot.path}`, { waitUntil: "networkidle" });
        if (shot.scroll)
          await page.locator(shot.scroll).first().scrollIntoViewIfNeeded();
        else await page.evaluate(() => scrollTo(0, 0));
        await page.waitForTimeout(500);
        await page.screenshot({
          path: join(out, `${shot.name}${suffix}.jpg`),
          type: "jpeg",
          quality: 82,
        });
      }
      if (suffix === "") {
        // The template's preview: the members page, light, as Naru's board
        // shows it.
        await context.close();
        const preview = await browser.newContext({
          viewport: { width: 1280, height: 960 },
          locale: "ko-KR",
        });
        const tab = await preview.newPage();
        await tab.goto(`${origin}/`, { waitUntil: "networkidle" });
        await tab.getByText("들어가기", { exact: true }).click();
        await tab.goto(`${origin}/members`, { waitUntil: "networkidle" });
        await tab.waitForTimeout(500);
        await tab.screenshot({
          path: join(root, "docs/template-preview.jpg"),
          type: "jpeg",
          quality: 85,
        });
        await preview.close();
      } else await context.close();
    }
} finally {
  await browser.close();
}
