// The site's frame, read once per page by members and visitors alike:
// design settings (adm/design_form.php), navigation (adm/menu_list.php) and
// main/intro banners (adm/banner_list.php, adm/intro_list.php) and the
// background music (cf_bgm, bgm.php).
import {
  PREFIX,
  SETTINGS,
  backgroundMusic,
  communityAccess,
  scheduled,
  siteOpen,
} from "../../modules/shared.js";

export const readOnly = ["site"];
export const visitors = ["site"];

const DESIGN = `${PREFIX}design`;
const MENUS = `${PREFIX}menus`;
const BANNERS = `${PREFIX}banners`;

const COLORS = ["accent", "muted", "paper", "ink", "line", "surface"];
const https = (value) =>
  typeof value === "string" &&
  value.length <= 2000 &&
  /^https:\/\/[^\s/@?#:]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/.test(value)
    ? value
    : null;
const short = (value, max) =>
  typeof value === "string" ? value.slice(0, max) : "";

/** Where a menu entry leads: a board, a content page, a member tab or an HTTPS page. */
function target(link) {
  if (typeof link !== "string") return null;
  const [kind, id] = link.split(":", 2);
  if (["board", "content", "tab"].includes(kind) && /^[\w-]{1,64}$/.test(id))
    return link;
  return https(link);
}

export async function site(ctx) {
  const access = await communityAccess(ctx);
  const saved = (await ctx.get(DESIGN, "site"))?.data ?? {};
  const colors = {};
  for (const key of COLORS)
    if (/^#[0-9a-f]{6}$/i.test(saved.colors?.[key] ?? ""))
      colors[key] = saved.colors[key];
  const design = {
    // 디자인 사용 (use_header): off, the page is plain, as a fresh install.
    enabled: saved.enabled === true,
    title: short(saved.title, 60),
    logo: https(saved.logo),
    background: https(saved.background),
    headerBackground: https(saved.headerBackground),
    font: ["sans", "serif", "mono"].includes(saved.font) ? saved.font : "sans",
    colors,
  };
  const readable = (row) =>
    row.data.enabled !== false &&
    !row.data.deleted &&
    access.level >= (Number.isInteger(row.data.level) ? row.data.level : 1);
  const order = (a, b) =>
    (a.data.order ?? 0) - (b.data.order ?? 0) || (a.id < b.id ? -1 : 1);
  const menus = (await ctx.list(MENUS, { size: 100 })).documents
    .filter((row) => readable(row) && target(row.data.link))
    .sort(order)
    .map((row) => ({
      id: row.id,
      name: short(row.data.name, 40),
      link: target(row.data.link),
      parent: typeof row.data.parent === "string" ? row.data.parent : null,
      newWindow: row.data.newWindow === true,
      mobile: row.data.mobile !== false,
    }));
  const banners = (await ctx.list(BANNERS, { size: 50 })).documents
    .filter(
      (row) =>
        readable(row) && https(row.data.image) && scheduled(row.data, ctx.now),
    )
    .sort(order)
    .map((row) => ({
      id: row.id,
      place: row.data.place === "intro" ? "intro" : "main",
      image: https(row.data.image),
      mobileImage: https(row.data.mobileImage),
      alt: short(row.data.alt, 200),
      url: https(row.data.url),
      newWindow: row.data.newWindow === true,
    }));
  const settings = (await ctx.get(SETTINGS, "community"))?.data ?? {};
  return {
    level: access.level,
    member: Boolean(ctx.member),
    // 사이트공개 (cf_open): off, visitors see only the sign-in screen.
    open: await siteOpen(ctx),
    design,
    bgm: backgroundMusic(settings.bgm),
    menus,
    banners,
  };
}
