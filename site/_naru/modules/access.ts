// Who may do what in the community, and the owner's settings, read from the
// site's tables. Every query and mutation calls these.
import type { QueryCtx, SqlValue } from "./naru-types.js";

/**
 * What these helpers use of a call's ctx: who calls and `sql`, as a query's
 * or mutation's ctx has them.
 */
export interface SqlCtx {
  readonly member: { readonly id: string } | null;
  readonly owner?: boolean;
  /** The call's time, when the ctx has one (queries' and mutations' do). */
  readonly now?: number;
  sql: QueryCtx["sql"];
}

/** The first row of a statement, or null. */
export async function one<Row = Record<string, SqlValue>>(
  ctx: SqlCtx,
  text: string,
  values: SqlValue[] = [],
): Promise<Row | null> {
  return ((await ctx.sql<Row>(text, values)).rows[0] ?? null) as Row | null;
}

/** An aggregate's one row (a count, a sum, the next number), which it always has. */
export async function only<Row = Record<string, SqlValue>>(
  ctx: SqlCtx,
  text: string,
  values: SqlValue[] = [],
): Promise<Row> {
  const row = await one<Row>(ctx, text, values);
  if (!row) throw new Error(`No row from ${text}`);
  return row;
}

/** A JSON column's object, or `fallback` when it is not one. */
export function parsed<T = Data>(text: unknown, fallback: T): T {
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
): Promise<Data> {
  const row = await one<{ value: string }>(
    ctx,
    "SELECT value FROM settings WHERE key = ?",
    [key],
  );
  return parsed(row?.value, {});
}
/** 커뮤니티 설정 (adm/community_form.php). */
export const communitySettings = (ctx: SqlCtx) => settingsOf(ctx, "community");

/**
 * 금액 사용 (ad_use_money, kept as viewerMoney): off, 화폐관리 is no page
 * of the site's (mypage/money/_head.php:5), as the original installs it.
 */
export async function moneyInUse(ctx: SqlCtx & Pick<QueryCtx, "fail">) {
  if ((await communitySettings(ctx)).viewerMoney !== true)
    ctx.fail("ACCESS_DENIED", "사용할 수 없는 페이지 입니다.", {
      reason: "money_off",
    });
}

/** What a caller may do in the community: their level and role. */
export interface Access {
  level: number;
  role: "guest" | "member" | "moderator";
  /** The member's ID, for the boards and groups they administer. */
  member?: string;
  /** A visitor of a closed site. */
  closed?: boolean;
  /** A member who left. */
  left?: boolean;
  /** A member the owner blocked (접근차단일) or deleted (회원 삭제). */
  blocked?: boolean;
  deleted?: boolean;
  /** The board groups whose members-only boards they may use. */
  groups?: string[];
}

/** Refuses a visitor (or the site's owner): the call is a member's. */
export function signedIn(
  ctx: Pick<SqlCtx, "member"> & Partial<Pick<QueryCtx, "fail">>,
): string {
  if (!ctx.member) {
    ctx.fail?.("AUTH_REQUIRED", "로그인해 주세요.", { reason: "sign_in" });
    // A helper's ctx without fail: its caller has checked for a member.
    throw new Error("Not signed in.");
  }
  return ctx.member.id;
}

/** Refuses anyone but the site's owner. */
export function requireOwner(ctx: Pick<QueryCtx, "owner" | "fail">) {
  if (!ctx.owner)
    ctx.fail("ACCESS_DENIED", "사이트 운영자만 할 수 있습니다.", {
      reason: "owner_only",
    });
}

/**
 * A query or mutation only the site's owner may call (the original's
 * adm/, `$is_admin == 'super'`): it refuses anyone else before `fn` runs,
 * and hands `fn` {} when no arguments came. Every export of admin/ is made
 * by it, so none can forget the check; tests/admin.test.mjs checks each
 * one's mark and calls each as a member, a moderator and a visitor.
 */
export function ownerOnly<C extends Pick<QueryCtx, "owner" | "fail">, A, R>(
  fn: (ctx: C, args: A) => R | Promise<R>,
) {
  return Object.assign(
    async (ctx: C, args: A): Promise<R> => {
      requireOwner(ctx);
      return await fn(ctx, (args ?? {}) as A);
    },
    { ownerOnly: true as const },
  );
}

/** A visitor's access: level 1, as GnuBoard gives a guest. */
export const GUEST_ACCESS: Access = Object.freeze({ level: 1, role: "guest" });

/** A visitor of a closed site: below every board's and page's level 1. */
export const CLOSED_ACCESS: Access = Object.freeze({
  level: 0,
  role: "guest",
  closed: true,
});

/** The role a moderator (게시물 운영자) has. */
export const STAFF = "staff";
/** The role of a members-only board group's members. */
export const GROUP_ROLE = "group-";

/**
 * 사이트공개 (cf_open): whether visitors who are not signed in may see the
 * community. On unless the owner turns it off (the original's install starts
 * with it off, extend/community.config.php sending guests to the login page).
 */
export async function siteOpen(ctx: SqlCtx): Promise<boolean> {
  return (await communitySettings(ctx)).siteOpen !== false;
}

/** Members' roles (member_roles), sorted, by ID: [] for a member with none. */
export async function rolesOfMembers(
  ctx: SqlCtx,
  ids: readonly string[],
): Promise<Record<string, string[]>> {
  const roles = new Map(ids.map((id) => [id, [] as string[]]));
  if (roles.size) {
    const { rows } = await ctx.sql<{ member: string; role: string }>(
      `SELECT member, role FROM member_roles
       WHERE member IN (SELECT value FROM json_each(?)) ORDER BY member, role`,
      [JSON.stringify([...roles.keys()])],
    );
    for (const { member, role } of rows) roles.get(member)?.push(role);
  }
  return Object.fromEntries(roles);
}

/** A member's roles (member_roles), sorted. */
export async function rolesOf(ctx: SqlCtx, id: string): Promise<string[]> {
  return (await rolesOfMembers(ctx, [id]))[id];
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
 * A member's level (1–10, or 1 before they join), role and groups; a member who left is a
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
  const row = await one<{
    level: number;
    left_on: string | null;
    blocked_on: string | null;
    deleted_at: number | null;
  }>(
    ctx,
    "SELECT level, left_on, blocked_on, deleted_at FROM members WHERE member = ?",
    [id],
  );
  // A member the owner deleted (adm/member_delete.php) is a guest for good.
  if (row?.deleted_at)
    return { ...GUEST_ACCESS, role: "member", deleted: true };
  // From their 접근차단일 on, a blocked member is a guest (login_check.php).
  if (row?.blocked_on && (!ctx.now || row.blocked_on <= kstDay(ctx.now)))
    return { ...GUEST_ACCESS, role: "member", blocked: true };
  // A member who left (bbs/member_leave.php) is a guest until the owner
  // clears their leave date.
  if (row?.left_on) return { ...GUEST_ACCESS, role: "member", left: true };
  const { role, groups } = accessOfRoles(await rolesOf(ctx, id));
  return {
    member: id,
    groups,
    // A member with no record has not joined (community/membership:join,
    // which sets 회원가입시 권한 and asks for the rules): level 1 until then.
    level:
      row && Number.isInteger(row.level) && row.level >= 1 && row.level <= 10
        ? row.level
        : 1,
    role,
  };
}

/**
 * Refuses a visitor, and a member the owner deleted or blocked or who left:
 * they are guests (communityAccess), who join, send, give and trade
 * nothing. Answers the member's ID.
 */
export async function activeMember(
  ctx: SqlCtx & Pick<QueryCtx, "fail">,
): Promise<string> {
  const member = signedIn(ctx);
  const access = await communityAccess(ctx);
  if (access.deleted)
    ctx.fail("ACCESS_DENIED", "삭제된 회원입니다.", { reason: "deleted" });
  if (access.blocked)
    ctx.fail("ACCESS_DENIED", "접근이 차단된 회원입니다.", {
      reason: "blocked",
    });
  if (access.left)
    ctx.fail("ACCESS_DENIED", "탈퇴한 회원입니다. 운영자에게 문의해 주세요.", {
      reason: "left",
    });
  return member;
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
export const reservedNicksOf = (settings: Data) =>
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

// The owner's names (names.ts), shared with the pages.
export { NAME_DEFAULTS, type Names, namesOf } from "./names.js";

import type { Data } from "./json.js";
import { type Names, namesOf } from "./names.js";
export async function names(ctx: SqlCtx): Promise<Names> {
  return namesOf(await communitySettings(ctx));
}

/** A word with its subject particle: 아보가, 경험치가, 포인트가, 골드가. */
export function subject(word: string) {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${word}이(가)`;
  return `${word}${(last - 0xac00) % 28 ? "이" : "가"}`;
}
/** "아보가 모자랍니다." in the owner's name for money or experience. */
export async function lacking(ctx: SqlCtx, key: keyof Names) {
  return `${subject((await names(ctx))[key])} 모자랍니다.`;
}
/** What a restricted character is refused for, in the owner's names. */
export function restrictedFor(named: Names, verb: string) {
  const kinds = [named.sideTitle, named.classTitle].filter(Boolean);
  return `이 캐릭터의 ${kinds.join("·") || "조건"}으로는 ${verb} 수 없습니다.`;
}

/** Refuses a call whose input is not what it takes (INVALID_REQUEST). */
export function invalid(ctx: Pick<QueryCtx, "fail">): never {
  return ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
    reason: "invalid_input",
  });
}

/** A whole, non-negative amount the owner set in 커뮤니티 설정, else 0. */
export function amountOf(settings: Data, key: string): number {
  // 포인트 사용 (cf_use_point) off: insert_point pays and takes nothing.
  if (settings.usePoint === false) return 0;
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
export function memberSettings(settings: Data) {
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
    // 추천인제도 사용 (cf_use_recommend): joining asks for a recommender.
    useRecommend: settings.useRecommend === true,
  };
}

/**
 * 게시판 기본 설정 (adm/config_form.php): 한페이지당 라인수 (cf_page_rows,
 * here at most 20, the lists' own limit; 20 for a site that never set it,
 * as they read before), 페이지 표시 수 (cf_write_pages 10, cf_mobile_pages
 * 5) and 새창 링크 (cf_link_target, _blank).
 */
export function pagingOf(settings: Data) {
  const within = (value: unknown, fallback: number, most: number) =>
    Number.isSafeInteger(value) && (value as number) >= 1
      ? Math.min(value as number, most)
      : fallback;
  return {
    rows: within(settings.pageRows, 20, 20),
    pages: within(settings.writePages, 10, 20),
    mobilePages: within(settings.mobilePages, 5, 20),
    linkTarget: ["_blank", "_self", "_top", "_new"].includes(
      settings.linkTarget,
    )
      ? (settings.linkTarget as string)
      : "_blank",
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
    (!data.startsAt ||
      (start !== null && Number.isFinite(start) && now >= start)) &&
    (!data.endsAt || (end !== null && Number.isFinite(end) && now < end))
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
