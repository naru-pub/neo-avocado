// Screenshots of a running copy of the community, as a visitor sees it, for
// the landing page: into landing/screenshots/ (light, and as name-dark.jpg,
// dark, as the site follows the system), and the template's preview on
// Naru's board into docs/ (1280×960, the size of Naru's own previews), which
// the workflow publishes with the template. The ones there were taken of
// neo-avocado.naru.pub before it became the landing page.
//
//   PLAYWRIGHT_MODULE=…/playwright/index.mjs node scripts/screenshots.mjs <origin>
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);

const origin = process.argv[2];
if (!origin) throw new Error("Usage: screenshots.mjs <origin>");
const root = fileURLToPath(new URL("../", import.meta.url));
const out = join(root, "landing/screenshots");
await mkdir(out, { recursive: true });

/** Pages a visitor reaches, as the landing shows them. */
const PAGES = [
  { name: "home", path: "/home" },
  { name: "members", path: "/members" },
];

/** A visitor's tab, past the entrance (cf_intro), which shows once a visit. */
async function visit(browser, options) {
  const context = await browser.newContext({ ...options, locale: "ko-KR" });
  const page = await context.newPage();
  await page.goto(`${origin}/`, { waitUntil: "networkidle" });
  await page.getByText("들어가기", { exact: true }).click();
  await page.waitForLoadState("networkidle");
  return { context, page };
}

const browser = await chromium.launch();
try {
  for (const colorScheme of ["light", "dark"]) {
    const { context, page } = await visit(browser, {
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      colorScheme,
    });
    for (const shot of PAGES) {
      await page.goto(`${origin}${shot.path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      await page.screenshot({
        path: join(
          out,
          `${shot.name}${colorScheme === "dark" ? "-dark" : ""}.jpg`,
        ),
        type: "jpeg",
        quality: 82,
      });
    }
    await context.close();
  }
  // The template's preview: the members page, light, as Naru's board shows it.
  const { context, page } = await visit(browser, {
    viewport: { width: 1280, height: 960 },
  });
  await page.goto(`${origin}/members`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: join(root, "docs/template-preview.jpg"),
    type: "jpeg",
    quality: 85,
  });
  await context.close();
} finally {
  await browser.close();
}
