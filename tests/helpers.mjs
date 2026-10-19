// What the unit tests share: who calls, refusals, rows made directly, and
// the owner's admin calls routed as the admin page routes them
// (_naru/modules/admin-calls.ts).
import { adminCall } from "../dist/_naru/shared/admin-calls.js";

export const M1 = { member: "m-1" };
export const M2 = { member: "m-2" };
export const M3 = { member: "m-3" };
export const OWNER = { owner: true };
export const VISITOR = {};

/** The reason a call refused with (its ctx.fail details), its code, or null. */
export const refusal = (call) =>
  call.then(
    () => null,
    (error) => {
      if (error.details?.reason) return error.details.reason;
      if (error.code) return error.code;
      throw error;
    },
  );
/** A call's refusal message, or null. */
export const refusedWith = (call) =>
  call.then(
    () => null,
    (error) => error.message,
  );
/** A call's refusal reason, or "ok". */
export const reasonOf = async (call) => (await refusal(call)) ?? "ok";

/** One of the owner's settings rows (community, design, profile…). */
export const setSettings = (site, key, value) =>
  site.run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    key,
    JSON.stringify(value),
  );

/** A row made directly, objects as JSON; answers its key as a string. */
export function insert(site, table, row) {
  const values = Object.values(row).map((value) =>
    value !== null && typeof value === "object" ? JSON.stringify(value) : value,
  );
  const columns = Object.keys(row);
  const { lastInsertRowid } = site.run(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    ...values,
  );
  return String(row.id ?? lastInsertRowid);
}

/**
 * A member's profile; the nickname is Hangul, letters and digits, so m-1's
 * is m1 unless given. `extra` is more columns. Like joining, it gives the
 * member a record at level 2 where they have none.
 */
export function profile(
  site,
  member,
  nick = member.replace(/-/g, ""),
  extra = {},
) {
  joined(site, member);
  return insert(site, "profiles", { member, nick, joined_at: 0, ...extra });
}

/** A member's record, as joining leaves it (level 2), where they have none. */
export const joined = (site, member, level = 2) =>
  site.run(
    "INSERT INTO members (member, level) VALUES (?, ?) ON CONFLICT (member) DO NOTHING",
    member,
    level,
  );

/** A character row, m-1's Hero unless `data` says otherwise; its ID. */
export const character = (site, data = {}) =>
  insert(site, "characters", {
    owner: "m-1",
    name: "Hero",
    created_at: site.now,
    ...data,
  });

/** A member's money, set. */
export const wallet = (site, member, balance) =>
  site.run(
    "INSERT INTO wallets (member, balance) VALUES (?, ?) ON CONFLICT (member) DO UPDATE SET balance = excluded.balance",
    member,
    balance,
  );
export const balanceOf = (site, member) =>
  site.rows("SELECT balance FROM wallets WHERE member = ?", member)[0]?.balance;

export const count = (site, table) =>
  site.rows(`SELECT count(*) AS n FROM ${table}`)[0].n;

/**
 * An admin call, "<section>:<call>" or "<module>:<export>", as the admin page
 * makes it: a section's plain calls are admin/records', with its section.
 */
function routed(name, args) {
  const [section, call] = name.split(":");
  const via = adminCall(section, call);
  return via && via.startsWith("admin/records:")
    ? [via, { section, ...(args ?? {}) }]
    : [`admin/${name}`, args];
}
export const adminQuery = (site, name, args = {}, who = OWNER) =>
  site.query(...routed(name, args), who);
export const adminMutate = (site, name, args = {}, who = OWNER) =>
  site.mutate(...routed(name, args), who);
