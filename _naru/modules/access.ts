// Who may do what in the community, and the owner's settings, read from the
// site's tables. Every query and mutation calls these, and so, until their
// areas are ported, do the old site functions and collection rules (Naru
// hands them ctx.sql too), so old and new code agree.
import type { QueryCtx, SqlValue } from "./naru-types.js";

/**
 * What these helpers use of a call's ctx: who calls and `sql`. A query's or
 * mutation's ctx has it; so do the old site functions' and rules'.
 */
export interface SqlCtx {
  readonly member: {
    readonly id: string;
    readonly roles?: readonly string[];
  } | null;
  readonly owner?: boolean;
  sql: QueryCtx["sql"];
  rolesOf?: QueryCtx["rolesOf"];
}

/** The first row of a statement, or null. */
export async function one<Row = Record<string, SqlValue>>(
  ctx: SqlCtx,
  text: string,
  values: SqlValue[] = [],
): Promise<Row | null> {
  return ((await ctx.sql<Row>(text, values)).rows[0] ?? null) as Row | null;
}

/** A JSON column's object, or `fallback` when it is not one. */
export function parsed<T = Record<string, any>>(text: unknown, fallback: T): T {
  if (typeof text !== "string") return fallback;
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

/** A settings row (community, profile, design), or {} when there is none. */
export async function settingsOf(
  ctx: SqlCtx,
  key: "community" | "profile" | "design",
): Promise<Record<string, any>> {
  const row = await one<{ value: string }>(
    ctx,
    "SELECT value FROM settings WHERE key = ?",
    [key],
  );
  return parsed(row?.value, {});
}
/** 커뮤니티 설정 (adm/community_form.php). */
export const communitySettings = (ctx: SqlCtx) => settingsOf(ctx, "community");

/** What a caller may do in the community: their level and role. */
export interface Access {
  level: number;
  role: "guest" | "member" | "moderator";
  /** A visitor of a closed site. */
  closed?: boolean;
  /** A member who left. */
  left?: boolean;
  /** The board groups whose members-only boards they may use. */
  groups?: string[];
}

/** Refuses a visitor (or the site's owner): the call is a member's. */
export function signedIn(ctx: SqlCtx & Pick<QueryCtx, "fail">): string {
  if (!ctx.member)
    ctx.fail("AUTH_REQUIRED", "로그인해 주세요.", { reason: "sign_in" });
  return ctx.member.id;
}

/** A visitor's access: level 1, as GnuBoard gives a guest. */
export const GUEST_ACCESS: Access = Object.freeze({ level: 1, role: "guest" });

/** A visitor of a closed site: below every board's and page's level 1. */
export const CLOSED_ACCESS: Access = Object.freeze({
  level: 0,
  role: "guest",
  closed: true,
});

/** The Naru role a moderator (게시물 운영자) has. */
export const STAFF = "staff";
/** The Naru role of a members-only board group's members. */
export const GROUP_ROLE = "group-";

/**
 * 사이트공개 (cf_open): whether visitors who are not signed in may see the
 * community. On unless the owner turns it off (the original's install starts
 * with it off, extend/community.config.php sending guests to the login page).
 */
export async function siteOpen(ctx: SqlCtx): Promise<boolean> {
  return (await communitySettings(ctx)).siteOpen !== false;
}

/**
 * A member's roles: the caller's own from ctx, anyone else's (and a rule's
 * caller, whose ctx carries none) by asking Naru.
 */
export async function rolesOf(ctx: SqlCtx, id: string): Promise<string[]> {
  if (ctx.member?.id === id && ctx.member.roles?.length)
    return [...ctx.member.roles];
  if (!ctx.rolesOf)
    return [...(ctx.member?.id === id ? (ctx.member.roles ?? []) : [])];
  return (await ctx.rolesOf([id]))[id] ?? [];
}

/** The community role and board groups that `roles` give. */
export function accessOfRoles(roles: readonly string[]) {
  return {
    role: roles.includes(STAFF) ? ("moderator" as const) : ("member" as const),
    groups: roles
      .filter((role) => role.startsWith(GROUP_ROLE))
      .map((role) => role.slice(GROUP_ROLE.length)),
  };
}

/**
 * A member's level (1–10, else 2), role and groups; a member who left is a
 * guest; a visitor is level 1, or 0 while the site is closed. The site's
 * owner, who is no member, is a visitor here as well.
 */
export async function communityAccess(
  ctx: SqlCtx,
  id: string | null | undefined = ctx.member?.id,
): Promise<Access> {
  // A closed site (cf_open off) shows visitors nothing, as the original
  // sends them to log in from every page (check_site_auth).
  if (!id) return (await siteOpen(ctx)) ? GUEST_ACCESS : CLOSED_ACCESS;
  const row = await one<{ level: number; left_on: string | null }>(
    ctx,
    "SELECT level, left_on FROM members WHERE member = ?",
    [id],
  );
  // A member who left (bbs/member_leave.php) is a guest until the owner
  // clears their leave date.
  if (row?.left_on) return { ...GUEST_ACCESS, role: "member", left: true };
  const { role, groups } = accessOfRoles(await rolesOf(ctx, id));
  return {
    groups,
    level:
      Number.isInteger(row?.level) && row.level >= 1 && row.level <= 10
        ? row.level
        : 2,
    role,
  };
}

/** Whether a page, menu or banner of `level` (1 when unset) shows at `access`. */
export const levelAllows = (access: Access, level: unknown) =>
  access.level >= (Number.isInteger(level) ? (level as number) : 1);

/**
 * 닉네임 금지 단어 (cf_prohibit_id), as the original installs it
 * (install/install_db.php). The admin's community settings keep the owner's
 * own list, comma-separated; an empty list reserves nothing.
 */
export const RESERVED_NICKS =
  "admin,administrator,관리자,운영자,어드민,주인장,webmaster,웹마스터,sysop,시삽,시샵,manager,매니저,메니저,root,루트,su,guest,방문객";

/** The reserved words of community settings, or the original's list. */
export const reservedNicksOf = (settings: Record<string, any>) =>
  typeof settings.reservedNicks === "string"
    ? settings.reservedNicks
    : RESERVED_NICKS;

/**
 * Whether a nickname is one of the reserved words (lib/register.lib.php's
 * reserve_mb_nick), ignoring case. The site owner may take one.
 */
export async function reservedNick(
  ctx: SqlCtx,
  nick: string,
): Promise<boolean> {
  if (ctx.owner) return false;
  const wanted = nick.trim().toLowerCase();
  return reservedNicksOf(await communitySettings(ctx))
    .split(",")
    .some((word) => word.trim() && word.trim().toLowerCase() === wanted);
}

/**
 * The owner's names (기타 항목명 설정: cf_money, cf_money_pice, cf_exp_name,
 * cf_exp_pice, cf_rank_name, cf_side_title, cf_class_title), the template's
 * own until changed. An empty 소속 or 종족 title hides it, as in the original.
 * names.js keeps the same defaults for the pages.
 */
export const NAME_DEFAULTS = Object.freeze({
  moneyName: "아보",
  moneyUnit: "아보",
  expName: "경험치",
  expUnit: "",
  rankName: "랭킹",
  sideTitle: "소속",
  classTitle: "종족",
});
/** The owner's names, by the keys of NAME_DEFAULTS. */
export type Names = { [K in keyof typeof NAME_DEFAULTS]: string };
export function namesOf(settings: Record<string, any> = {}): Names {
  const names = {} as Names;
  for (const [key, fallback] of Object.entries(NAME_DEFAULTS)) {
    const value = settings?.[key];
    names[key] =
      typeof value === "string" &&
      (value.trim() || ["expUnit", "sideTitle", "classTitle"].includes(key))
        ? value.trim().slice(0, 20)
        : fallback;
  }
  return names;
}
export async function names(ctx: SqlCtx): Promise<Names> {
  return namesOf(await communitySettings(ctx));
}

/** A whole, non-negative amount the owner set in 커뮤니티 설정, else 0. */
export function amountOf(settings: Record<string, any>, key: string): number {
  const value = settings[key];
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}
export async function communityAmount(
  ctx: SqlCtx,
  key: string,
): Promise<number> {
  return amountOf(await communitySettings(ctx), key);
}

/**
 * The community settings members' pages need (message cost, starting stat
 * points, the shop's categories, NPC and greeting, character switches, the
 * rules a new member agrees to and the reserved nicknames), and nothing else
 * the admin keeps there.
 */
export function memberSettings(settings: Record<string, any>) {
  return {
    initialStatPoints: settings.initialStatPoints ?? 0,
    messageCost: settings.messageCost ?? 0,
    shopCategories: settings.shopCategories ?? "일반, 이벤트",
    shopNpc: settings.shopNpc ?? null,
    shopGreeting: settings.shopGreeting ?? "",
    characterCreation: settings.characterCreation !== false,
    characterEditing: settings.characterEditing !== false,
    characterLimit: Number.isSafeInteger(settings.characterLimit)
      ? settings.characterLimit
      : 1,
    // 커뮤니티 활동 규칙 and 캐릭터 유의사항 (cf_stipulation, cf_privacy),
    // shown when joining (skin/member/basic/register.skin.php).
    stipulation:
      typeof settings.stipulation === "string" ? settings.stipulation : "",
    characterNotice:
      typeof settings.characterNotice === "string"
        ? settings.characterNotice
        : "",
    reservedNicks: reservedNicksOf(settings),
  };
}

/** A Korean day, "YYYY-MM-DD". */
export const kstDay = (now: number): string =>
  new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

/** A Korean local "YYYY-MM-DDTHH:mm[:ss]" as milliseconds; null if blank, NaN if malformed. */
export function kstStamp(value: unknown): number | null {
  if (!value) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)
  )
    return NaN;
  const stamp = Date.parse(`${value}+09:00`);
  return Number.isFinite(stamp) &&
    new Date(stamp + 9 * 3600000).toISOString().slice(0, value.length) === value
    ? stamp
    : NaN;
}

/** Whether `now` is inside a row's optional startsAt (inclusive) and endsAt (exclusive). */
export function scheduled(
  data: { startsAt?: unknown; endsAt?: unknown },
  now: number,
): boolean {
  const start = kstStamp(data.startsAt),
    end = kstStamp(data.endsAt);
  return (
    (!data.startsAt || (Number.isFinite(start) && now >= start)) &&
    (!data.endsAt || (Number.isFinite(end) && now < end))
  );
}

/** A LIKE pattern finding `text` anywhere, with LIKE's own characters escaped by `\`. */
export const containing = (text: string) =>
  `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;

/** A string of at most `max` characters, trimmed; refused otherwise. */
export function text(value: unknown, max: number, required = false): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error("Invalid text input.");
  return value.trim();
}

/** An HTTPS address for a picture or link, at most 2,000 characters; refused otherwise. */
export function imageUrl(value: unknown): string {
  const url = text(value, 2000, true);
  // QuickJS has no URL constructor. Browser images must use HTTPS, with no
  // credentials, whitespace, data payloads or script schemes.
  if (!/^https:\/\/[^\s/@?#:]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/.test(url))
    throw new Error("An image must have an HTTPS address.");
  return url;
}

export function amount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`${label} must be a non-negative safe integer.`);
  return value as number;
}
