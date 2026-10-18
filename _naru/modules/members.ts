// Members' rows in the site's tables: profiles, 관심 posts, wallets and
// history. Queries and mutations use them; a profile and a history row keep
// the shape pages know ({ id, data }).
import { communityAmount, kstDay, one, parsed } from "./access.js";
import type { SqlCtx } from "./access.js";
import type { QueryCtx, SqlValue } from "./naru-types.js";

/** A profile as pages and old code read it. */
export interface Profile {
  id: string;
  data: {
    owner: string;
    nick: string;
    acceptMessages: boolean;
    commentAlerts: boolean;
    callsSeenAt?: number;
    mainCharacter?: string | null;
    /** 출생년도 (mb_birth), when given. */
    birthYear?: number;
    deleted?: boolean;
    /** The member's own 관심 posts, newest first, when asked for. */
    favorites?: string[];
  };
}

export interface ProfileRow {
  member: string;
  nick: string;
  accept_messages: number;
  comment_alerts: number;
  calls_seen_at: number | null;
  main_character: string | null;
  deleted_at: number | null;
  birth_year?: number | null;
}

export function profileOfRow(row: ProfileRow | null): Profile | null {
  if (!row) return null;
  return {
    id: row.member,
    data: {
      owner: row.member,
      nick: row.nick,
      acceptMessages: row.accept_messages !== 0,
      commentAlerts: row.comment_alerts !== 0,
      ...(row.calls_seen_at !== null ? { callsSeenAt: row.calls_seen_at } : {}),
      mainCharacter: row.main_character ?? null,
      ...(row.birth_year ? { birthYear: row.birth_year } : {}),
      ...(row.deleted_at !== null ? { deleted: true } : {}),
    },
  };
}

/** 출생년도 (mb_birth): a year from 1900 to 2100, or none. */
export const birthYearValid = (value: unknown) =>
  value === undefined ||
  value === null ||
  (Number.isInteger(value) &&
    (value as number) >= 1900 &&
    (value as number) <= 2100);

/** A member's profile, or null before they join. */
export async function profileOf(
  ctx: SqlCtx,
  member: string | null | undefined,
  { favorites = false } = {},
): Promise<Profile | null> {
  if (typeof member !== "string" || !member) return null;
  const profile = profileOfRow(
    await one<ProfileRow>(ctx, "SELECT * FROM profiles WHERE member = ?", [
      member,
    ]),
  );
  if (profile && favorites)
    profile.data.favorites = await favoritesOf(ctx, member);
  return profile;
}

/** The member with this nickname, or null. */
export async function profileByNick(
  ctx: SqlCtx,
  nick: unknown,
): Promise<Profile | null> {
  if (typeof nick !== "string" || !nick) return null;
  return profileOfRow(
    await one<ProfileRow>(ctx, "SELECT * FROM profiles WHERE nick = ?", [nick]),
  );
}

/** Refuses a nickname another member has (the profiles table keeps it unique). */
export async function nickTaken(
  ctx: SqlCtx & Pick<QueryCtx, "fail">,
  nick: string,
  member: string,
) {
  if (
    await one(ctx, "SELECT 1 FROM profiles WHERE nick = ? AND member != ?", [
      nick,
      member,
    ])
  )
    ctx.fail("CONFLICT", "이미 쓰는 닉네임입니다.", {
      reason: "nick_taken",
      unique: "nick",
    });
}

/** Changes a profile's 대표 character. */
export async function setMainCharacter(
  ctx: SqlCtx,
  member: string,
  character: string | null,
) {
  await ctx.sql`UPDATE profiles SET main_character = ${character} WHERE member = ${member}`;
}

/** 관심로그 (mmb's 관심): at most 200. */
export const FAVORITE_LIMIT = 200;

/** A member's 관심 posts' IDs, newest first. */
export async function favoritesOf(ctx: SqlCtx, member: string) {
  return (
    await ctx.sql<{
      post: number;
    }>`SELECT post FROM favorites WHERE member = ${member} ORDER BY id DESC LIMIT ${FAVORITE_LIMIT}`
  ).rows.map((row) => String(row.post));
}

/** A wallet: its balance and the day the login reward was last paid. */
export interface Wallet {
  balance: number;
  lastDaily: string | null;
}
export async function walletOf(ctx: SqlCtx, member: string): Promise<Wallet> {
  const row = await one<{ balance: number; last_daily: string | null }>(
    ctx,
    "SELECT balance, last_daily FROM wallets WHERE member = ?",
    [member],
  );
  return row
    ? { balance: row.balance, lastDaily: row.last_daily }
    : { balance: 0, lastDaily: null };
}

/** Sets a member's balance, and the day of the login reward when given. */
export async function saveWallet(
  ctx: SqlCtx,
  member: string,
  balance: number,
  lastDaily?: string | null,
) {
  if (!Number.isSafeInteger(balance) || balance < 0)
    throw new Error("Balance is outside its allowed range.");
  if (lastDaily === undefined)
    await ctx.sql`INSERT INTO wallets (member, balance) VALUES (${member}, ${balance}) ON CONFLICT (member) DO UPDATE SET balance = excluded.balance`;
  else
    await ctx.sql`INSERT INTO wallets (member, balance, last_daily) VALUES (${member}, ${balance}, ${lastDaily}) ON CONFLICT (member) DO UPDATE SET balance = excluded.balance, last_daily = excluded.last_daily`;
}

/** A history entry's columns, by the names old code and pages use. */
const HISTORY_COLUMNS = {
  owner: "owner",
  kind: "kind",
  at: "at",
  delta: "delta",
  balance: "balance",
  expDelta: "exp_delta",
  exp: "exp",
  memo: "memo",
  actor: "actor",
  item: "item_id",
  inventory: "inventory_id",
  character: "character_id",
} as const;

/** Adds a history row; what has no column of its own goes in details. */
export async function addHistory(
  ctx: SqlCtx,
  entry: Record<string, any>,
): Promise<number> {
  const columns: string[] = [];
  const values: SqlValue[] = [];
  const details = {};
  for (const [key, value] of Object.entries(entry)) {
    if (value === undefined) continue;
    if (Object.hasOwn(HISTORY_COLUMNS, key)) {
      columns.push(HISTORY_COLUMNS[key]);
      values.push(value);
    } else details[key] = value;
  }
  columns.push("details");
  values.push(JSON.stringify(details));
  const { rows } = await ctx.sql<{ id: number }>(
    `INSERT INTO history (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING id`,
    values,
  );
  return rows[0].id;
}

export type HistoryRow = Record<string, SqlValue> & {
  id: number;
  details: string;
};

/** A history row as pages read it: { id, data } with the entry's own names. */
export function historyOfRow(row: HistoryRow) {
  const data: Record<string, any> = parsed(row.details, {});
  for (const [key, column] of Object.entries(HISTORY_COLUMNS))
    if (row[column] !== null && row[column] !== undefined)
      data[key] = row[column];
  return { id: String(row.id), data };
}

/**
 * A page of history, newest first: rows matching `where` (column = value),
 * `size` of them, after the cursor a previous page gave.
 */
export async function historyPage(
  ctx: SqlCtx,
  where: Record<string, SqlValue>,
  {
    size = 20,
    after = null,
    money = false,
  }: { size?: number; after?: string | null; money?: boolean } = {},
) {
  const clauses: string[] = [];
  const values: SqlValue[] = [];
  for (const [key, value] of Object.entries(where)) {
    clauses.push(`${HISTORY_COLUMNS[key]} = ?`);
    values.push(value);
  }
  // Only rows that moved money (the money ledger).
  if (money) clauses.push("delta IS NOT NULL");
  if (after !== null) {
    const cursor = Number(after);
    clauses.push("id < ?");
    values.push(Number.isSafeInteger(cursor) ? cursor : 0);
  }
  values.push(size + 1);
  const { rows } = await ctx.sql<HistoryRow>(
    `SELECT * FROM history${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`,
    values,
  );
  const documents = rows.slice(0, size).map(historyOfRow);
  return {
    documents,
    nextCursor: rows.length > size ? documents.at(-1).id : null,
  };
}

/**
 * The day's first visit pays the 로그인 보상 (common.php:401, cf_login_point),
 * once a Korean day; the original installs it at 0. The wallet keeps the
 * day, so later visits that day pay nothing. A member who left gets none.
 * Answers the new balance, or null when nothing was paid.
 */
export async function loginReward(
  ctx: SqlCtx & { now: number },
): Promise<number | null> {
  const member = ctx.member.id;
  const current = await walletOf(ctx, member);
  const today = kstDay(ctx.now);
  if (current.lastDaily === today) return null;
  if (
    await one(
      ctx,
      "SELECT 1 FROM members WHERE member = ? AND left_on IS NOT NULL",
      [member],
    )
  )
    return null;
  const reward = await communityAmount(ctx, "loginReward");
  const balance = current.balance + reward;
  await saveWallet(ctx, member, balance, today);
  if (!reward) return null;
  // insert_point's memo, "YYYY-MM-DD 첫로그인".
  await addHistory(ctx, {
    owner: member,
    kind: "daily",
    at: ctx.now,
    delta: reward,
    balance,
    memo: `${today} 첫로그인`,
  });
  return balance;
}
