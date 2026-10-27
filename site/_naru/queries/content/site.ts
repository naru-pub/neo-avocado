// The site's frame, read once per page by members and visitors alike:
// design settings (adm/design_form.php), navigation (adm/menu_list.php) and
// main/intro banners (adm/banner_list.php, adm/intro_list.php) and the
// background music (cf_bgm, bgm.php).
import {
  communityAccess,
  levelAllows,
  memberSettings,
  namesOf,
  pagingOf,
  scheduled,
  settingsOf,
  signedIn,
} from "../../modules/access.js";
import {
  backgroundMusic,
  MAIN_PAGE,
  MENU_PAGE,
  readablePage,
} from "../../modules/content.js";
import {
  designCss,
  designLayout,
  designLook,
  ownerMarks,
} from "../../modules/design.js";
import { imageSlotsOf, nameFieldOf, viewerOf } from "../../modules/images.js";
import type { QueryCtx } from "../../modules/naru-types.js";
import { latestPoll } from "../../modules/polls.js";

const COLORS = ["accent", "muted", "paper", "ink", "line", "surface"];
// The background's 배경반복 and 배경위치 (adm/design_form.php's cs_etc_2,
// cs_etc_3); the first of each is the original's blank, the default.
const REPEATS = ["repeat", "no-repeat", "repeat-x", "repeat-y"];
const POSITIONS = [
  "left top",
  "left center",
  "left bottom",
  "center top",
  "center center",
  "center bottom",
  "right top",
  "right center",
  "right bottom",
];
const choice = (value: unknown, choices: string[]): string =>
  choices.includes(value as string) ? (value as string) : choices[0];
const https = (value: unknown): string | null =>
  typeof value === "string" &&
  value.length <= 2000 &&
  /^https:\/\/[^\s/@?#:]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/.test(value)
    ? value
    : null;
const short = (value: unknown, max: number): string =>
  typeof value === "string" ? value.slice(0, max) : "";

/** Where a menu entry leads: a board, a content page, a member tab or an HTTPS page. */
function target(link: unknown): string | null {
  if (typeof link !== "string") return null;
  const [kind, id] = link.split(":", 2);
  if (["board", "content", "tab"].includes(kind) && /^[\w-]{1,64}$/.test(id))
    return link;
  return https(link);
}

interface MenuRow {
  id: string;
  name: string;
  link: string;
  parent: string | null;
  level: number;
  enabled: number;
  mobile: number;
  new_window: number;
}
interface BannerRow {
  id: string;
  place: string;
  image: string;
  mobile_image: string | null;
  alt: string;
  url: string | null;
  new_window: number;
  starts_at: string | null;
  ends_at: string | null;
  level: number;
  enabled: number;
}

export async function site(ctx: QueryCtx) {
  const access = await communityAccess(ctx);
  const saved = await settingsOf(ctx, "design");
  const look = designLook(saved);
  const colors = {};
  for (const key of COLORS)
    if (/^#[0-9a-f]{6}$/i.test(saved.colors?.[key] ?? ""))
      colors[key] = saved.colors[key];
  const design = {
    // 디자인 사용 (use_header): off, the page is plain, as a fresh install.
    enabled: saved.enabled === true,
    title: short(saved.title, 60),
    description: short(saved.description, 300),
    favicon: https(saved.favicon),
    logo: https(saved.logo),
    // m_logo, m_background: what a phone shows instead, when set.
    mobileLogo: https(saved.mobileLogo),
    background: https(saved.background),
    mobileBackground: https(saved.mobileBackground),
    backgroundColor: /^#[0-9a-f]{6}$/i.test(saved.backgroundColor ?? "")
      ? saved.backgroundColor
      : null,
    backgroundRepeat: choice(saved.backgroundRepeat, REPEATS),
    backgroundPosition: choice(saved.backgroundPosition, POSITIONS),
    headerBackground: https(saved.headerBackground),
    font: ["sans", "serif", "mono"].includes(saved.font) ? saved.font : "sans",
    colors,
    // 헤더사용 and 메뉴위치 (use_header, menu_pos), and the rest of 디자인
    // 설정 as CSS (design_form_css.php), every value checked (design.ts).
    useHeader: designLayout(saved).useHeader,
    menuPosition: designLayout(saved).menuPosition,
    css: designCss(saved),
    // The look as the page applies it, and as each page's head already has
    // it (designLook): the <body> classes, the design layer, 사용자 CSS.
    classes: look.classes,
    layer: look.layer,
    customCss: look.customCss,
    ownerFiles: look.ownerFiles,
    // 「작성자」 원글 작성자's 접두문자 and 접미문자, which the page writes as text.
    ownerMarks: ownerMarks(saved),
    // mmb_counter: the owner's HTML, which the page sanitizes as posts.
    counter: short(saved.counter, 2000),
  };
  // What is shown now, by its schedule's Korean local times, before any
  // limit; scheduled() then checks each to the minute.
  const local = new Date(ctx.now + 9 * 3600 * 1000).toISOString().slice(0, 16);
  const readable = (row: { enabled: number; level: number }) =>
    row.enabled !== 0 && levelAllows(access, row.level);
  const menus = (
    await ctx.sql<MenuRow>`SELECT * FROM menus ORDER BY sort_order, created_at, id LIMIT 100`
  ).rows
    .filter((row) => readable(row) && target(row.link))
    .map((row) => ({
      id: row.id,
      name: short(row.name, 40),
      link: target(row.link),
      parent: row.parent || null,
      newWindow: row.new_window === 1,
      mobile: row.mobile !== 0,
    }));
  const banners = (
    await ctx.sql<BannerRow>`SELECT * FROM banners
      WHERE (coalesce(starts_at, '') = '' OR starts_at <= ${local})
        AND (coalesce(ends_at, '') = '' OR ends_at > ${local})
      ORDER BY sort_order, created_at, id LIMIT 50`
  ).rows
    .filter(
      (row) =>
        readable(row) &&
        https(row.image) &&
        scheduled({ startsAt: row.starts_at, endsAt: row.ends_at }, ctx.now),
    )
    .map((row) => ({
      id: row.id,
      place: row.place === "intro" ? "intro" : "main",
      image: https(row.image),
      mobileImage: https(row.mobile_image),
      alt: short(row.alt, 200),
      url: https(row.url),
      newWindow: row.new_window === 1,
    }));
  const settings = await settingsOf(ctx, "community");
  const profile = await settingsOf(ctx, "profile");
  return {
    level: access.level,
    member: Boolean(ctx.member),
    // 사이트공개 (cf_open): off, visitors see only the sign-in screen.
    open: settings.siteOpen !== false,
    design,
    bgm: backgroundMusic(settings.bgm),
    // 쪽지·호출 알림음: the arrival popups' chime, off unless the owner wants it.
    alarmSound: settings.alarmSound === true,
    // 설문조사: the newest poll in use (poll.skin.php on the main page).
    poll: (await latestPoll(ctx)).poll,
    // 팝업레이어 (bbs/newwin.inc.php): those between their times, in order.
    popups: (
      await ctx.sql<{
        id: string;
        subject: string;
        content: string;
        device: string;
        starts_at: string | null;
        ends_at: string | null;
        disable_hours: number;
        left_px: number;
        top_px: number;
        width_px: number;
        height_px: number;
      }>`SELECT * FROM popups WHERE enabled != 0
        AND (coalesce(starts_at, '') = '' OR starts_at <= ${local})
        AND (coalesce(ends_at, '') = '' OR ends_at > ${local})
        ORDER BY created_at, id LIMIT 20`
    ).rows
      .filter((row) =>
        scheduled({ startsAt: row.starts_at, endsAt: row.ends_at }, ctx.now),
      )
      .map((row) => ({
        id: row.id,
        subject: short(row.subject, 200),
        content: short(row.content, 20000),
        device: ["pc", "mobile"].includes(row.device) ? row.device : "both",
        disableHours: row.disable_hours,
        left: row.left_px,
        top: row.top_px,
        width: row.width_px,
        height: row.height_px,
      })),
    // 소속 icons (get_side_icon), by name, beside a writer's character.
    sideIcons: Object.fromEntries(
      (
        await ctx.sql<{ name: string; image: string | null }>`
          SELECT name, image FROM sides WHERE image IS NOT NULL LIMIT 100`
      ).rows
        .filter((row) => https(row.image))
        .map((row) => [row.name, row.image]),
    ),
    // cf_twitter: the account {{TWITTER}} shows, a handle and nothing else.
    twitter: /^[A-Za-z0-9_]{1,15}$/.test(settings.twitter ?? "")
      ? settings.twitter
      : null,
    // 관리자 아이콘 (ico_admin): the site owner's mark on their comments.
    adminIcon: https(settings.adminIcon),
    // 금액 사용 (ad_use_money): whether 마이페이지 has 화폐관리.
    money: settings.viewerMoney === true,
    // 조합(레시피)사용 (cf_5): whether a post offers 조합.
    recipes: settings.recipes !== false,
    // 한페이지당 라인수, 페이지 표시 수 and 새창 링크.
    paging: pagingOf(settings),
    // 기타 항목명 설정: the owner's names for money, experience, rank, 소속, 종족.
    names: namesOf(settings),
    // 프로필 양식 관리's 두상·흉상·전신: which the sheet asks for and shows.
    images: imageSlotsOf(profile),
    // ...the name's own label and help (ad_text_name, ad_help_name)...
    nameField: nameFieldOf(profile),
    // ...and what a character's page shows (ad_use_exp, _rank, _status…).
    viewer: viewerOf(profile),
    // 메인화면 구성 (adm/viewer_form.php): a content page site_main the
    // reader may see takes the home's place (main.php).
    main: Boolean(await readablePage(ctx, MAIN_PAGE, access)),
    // 화면 설정's 메뉴영역 (viewer_form.php, head.php:56): a content page
    // site_menu the reader may see takes the menu's place.
    menuPage: Boolean(await readablePage(ctx, MENU_PAGE, access)),
    menus,
    banners,
  };
}

/**
 * The community settings members' pages need (memberSettings), for a
 * signed-in member, before joining too.
 */
export async function settings(ctx: QueryCtx) {
  signedIn(ctx);
  return memberSettings(await settingsOf(ctx, "community"));
}
