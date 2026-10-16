// For the time being: the foundation's tables read and written as the
// documents of the collections they replaced, for code not ported yet (the
// admin page, through the owner-only admin/documents query and mutation).
// It goes when the admin area is ported to its own mutations.
import { GROUP_ROLE, STAFF, parsed } from "./access.js";
import type { QueryCtx, SqlValue } from "./naru-types.js";

const P = "neo_avocado_";

type Kind = "text" | "int" | "bool" | "json" | "flag";
/** A document field, its column, how it is kept, and the column's value when the field is missing. */
type Column = readonly [
  field: string,
  column: string,
  kind: Kind,
  fallback: SqlValue,
];

export interface Mapping {
  collection: string;
  table: string;
  /** The key column; a document's ID. */
  key: string;
  /** A settings row: the ID is the key, the document its JSON value. */
  settings?: { id: string; key: string } | true;
  columns: Column[];
  /** The JSON column keeping fields without columns of their own. */
  extra?: string;
  /** The key is made by the table (history). */
  generated?: boolean;
  /** Members: role and groups are Naru roles. */
  roles?: boolean;
  /** The key also stands in the document (visits' day, profiles' owner). */
  keyField?: string;
  /** How lists are ordered. */
  order: string;
}

const mapping = (
  name: string,
  table: string,
  key: string,
  columns: Column[],
  rest: Partial<Mapping> = {},
): Mapping => ({
  collection: `${P}${name}`,
  table,
  key,
  columns,
  order: `${key} ASC`,
  ...rest,
});

export const MAPPINGS: Record<string, Mapping> = Object.fromEntries(
  [
    mapping("settings", "settings", "key", [], { settings: true }),
    mapping("design", "settings", "key", [], {
      settings: { id: "site", key: "design" },
    }),
    mapping(
      "members",
      "members",
      "member",
      [
        ["level", "level", "int", 2],
        ["adult", "adult", "bool", 0],
        ["warnings", "warnings", "int", 0],
        ["warningNote", "warning_note", "text", ""],
        ["left", "left_on", "text", null],
        ["note", "note", "text", ""],
        ["agreedAt", "agreed_at", "int", null],
        ["requestedAt", "requested_at", "int", null],
      ],
      { roles: true },
    ),
    mapping(
      "profiles",
      "profiles",
      "member",
      [
        ["nick", "nick", "text", ""],
        ["acceptMessages", "accept_messages", "bool", 1],
        ["commentAlerts", "comment_alerts", "bool", 1],
        ["callsSeenAt", "calls_seen_at", "int", null],
        ["mainCharacter", "main_character", "text", null],
        ["deleted", "deleted_at", "flag", null],
      ],
      { keyField: "owner" },
    ),
    mapping("wallets", "wallets", "member", [
      ["balance", "balance", "int", 0],
      ["lastDaily", "last_daily", "text", null],
    ]),
    mapping(
      "history",
      "history",
      "id",
      [
        ["owner", "owner", "text", ""],
        ["kind", "kind", "text", ""],
        ["at", "at", "int", 0],
        ["delta", "delta", "int", null],
        ["balance", "balance", "int", null],
        ["expDelta", "exp_delta", "int", null],
        ["exp", "exp", "int", null],
        ["memo", "memo", "text", null],
        ["actor", "actor", "text", null],
        ["item", "item_id", "text", null],
        ["inventory", "inventory_id", "text", null],
        ["character", "character_id", "text", null],
      ],
      { extra: "details", generated: true, order: "id DESC" },
    ),
    mapping("presence", "presence", "member", [
      ["where", "place", "text", ""],
      ["at", "at", "int", 0],
    ]),
    mapping(
      "visits",
      "visits",
      "day",
      [
        ["total", "total", "int", 0],
        ["guests", "guests", "int", 0],
        ["members", "members", "json", "{}"],
        ["hours", "hours", "json", "{}"],
        ["browsers", "browsers", "json", "{}"],
        ["os", "os", "json", "{}"],
        ["devices", "devices", "json", "{}"],
        ["domains", "domains", "json", "{}"],
      ],
      { keyField: "day" },
    ),
    mapping("content", "content", "id", [
      ["name", "name", "text", ""],
      ["enabled", "enabled", "bool", 1],
      ["readLevel", "read_level", "int", 1],
      ["format", "format", "text", "html"],
      ["body", "body", "text", ""],
      ["mobileBody", "mobile_body", "text", ""],
      ["headerImage", "header_image", "text", null],
      ["footerImage", "footer_image", "text", null],
    ]),
    mapping("menus", "menus", "id", [
      ["name", "name", "text", ""],
      ["link", "link", "text", ""],
      ["parent", "parent", "text", null],
      ["order", "sort_order", "int", 0],
      ["level", "level", "int", 1],
      ["enabled", "enabled", "bool", 1],
      ["mobile", "mobile", "bool", 1],
      ["newWindow", "new_window", "bool", 0],
    ]),
    mapping("banners", "banners", "id", [
      ["place", "place", "text", "main"],
      ["image", "image", "text", ""],
      ["mobileImage", "mobile_image", "text", null],
      ["alt", "alt", "text", ""],
      ["url", "url", "text", null],
      ["newWindow", "new_window", "bool", 0],
      ["startsAt", "starts_at", "text", null],
      ["endsAt", "ends_at", "text", null],
      ["order", "sort_order", "int", 0],
      ["level", "level", "int", 1],
      ["enabled", "enabled", "bool", 1],
    ]),
    mapping("quests", "quests", "id", [
      ["name", "name", "text", ""],
      ["type", "type", "text", "daily"],
      ["side", "side", "text", ""],
      ["startsAt", "starts_at", "text", null],
      ["endsAt", "ends_at", "text", null],
      ["images", "images", "json", "[]"],
    ]),
  ].map((entry) => [entry.collection, entry]),
);

/** The mapping of a collection this port moved into a table, or null. */
export const mappingOf = (collection: unknown): Mapping | null =>
  typeof collection === "string" && Object.hasOwn(MAPPINGS, collection)
    ? MAPPINGS[collection]
    : null;

/** A settings document's row key. */
export const settingsKey = (map: Mapping, id: string) =>
  map.settings === true ? id : map.settings.key;

/** An empty field reads as none, as a document without it. */
const empty = (value: unknown) =>
  value === undefined || value === null || value === "";

/** The column values a document's data keeps, by column. */
export function rowOf(
  map: Mapping,
  data: Record<string, any>,
  now: number,
): Record<string, SqlValue> {
  if (map.settings) return { value: JSON.stringify(data ?? {}) };
  const row: Record<string, SqlValue> = {};
  for (const [field, column, kind, fallback] of map.columns) {
    const value = data?.[field];
    row[column] =
      kind === "bool"
        ? value === undefined || value === null
          ? fallback
          : value
            ? 1
            : 0
        : kind === "flag"
          ? value
            ? now
            : null
          : kind === "json"
            ? value === undefined || value === null
              ? fallback
              : JSON.stringify(value)
            : kind === "int"
              ? Number.isSafeInteger(value)
                ? value
                : fallback
              : empty(value) && fallback === null
                ? null
                : typeof value === "string"
                  ? value
                  : (fallback as string | null);
  }
  if (map.extra) {
    const known = new Set([
      ...map.columns.map(([field]) => field),
      ...(map.keyField ? [map.keyField] : []),
    ]);
    const extra = {};
    for (const [key, value] of Object.entries(data ?? {}))
      if (!known.has(key) && value !== undefined) extra[key] = value;
    row[map.extra] = JSON.stringify(extra);
  }
  return row;
}

/** A row as its document's data. */
export function dataOf(
  map: Mapping,
  row: Record<string, SqlValue>,
  roles: readonly string[] = [],
): Record<string, any> {
  if (map.settings) return parsed(row.value, {});
  const data: Record<string, any> = map.extra ? parsed(row[map.extra], {}) : {};
  if (map.keyField) data[map.keyField] = row[map.key];
  for (const [field, column, kind, fallback] of map.columns) {
    const value = row[column];
    if (value === null || value === undefined) continue;
    data[field] =
      kind === "bool" || kind === "flag"
        ? kind === "flag" || value !== 0
        : kind === "json"
          ? parsed(value, fallback === "[]" ? [] : {})
          : value;
  }
  if (map.roles) {
    data.role = roles.includes(STAFF) ? "moderator" : "member";
    data.groups = roles
      .filter((role) => role.startsWith(GROUP_ROLE))
      .map((role) => role.slice(GROUP_ROLE.length));
  }
  return data;
}

/** A member's roles after a members document is saved: its role and groups, and the others kept. */
export function rolesOfData(
  data: Record<string, any>,
  before: readonly string[] = [],
): string[] {
  return [
    ...new Set([
      ...before.filter(
        (role) => role !== STAFF && !role.startsWith(GROUP_ROLE),
      ),
      ...(data?.role === "moderator" ? [STAFF] : []),
      ...(Array.isArray(data?.groups)
        ? data.groups
            .filter((id) => typeof id === "string" && id)
            .map((id) => `${GROUP_ROLE}${id}`)
        : []),
    ]),
  ].sort();
}

/**
 * A document's revision: a hash of its data, so a write can ask that it is
 * still what the owner opened.
 */
export function revisionOf(data: unknown): string {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify(data ?? null)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** The mapping a call names, for the site's owner only. */
export function ownerMapping(ctx: QueryCtx, collection: unknown): Mapping {
  if (!ctx.owner)
    ctx.fail("ACCESS_DENIED", "사이트 운영자만 할 수 있습니다.", {
      reason: "owner_only",
    });
  const map = mappingOf(collection);
  if (!map)
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  return map;
}

/** Rows as documents, with members' roles. */
export async function documentsOf(
  ctx: QueryCtx,
  map: Mapping,
  rows: Record<string, SqlValue>[],
) {
  const roles = map.roles
    ? await ctx.rolesOf(rows.map((row) => String(row[map.key])))
    : {};
  return rows.map((row) => {
    const id = map.settings
      ? map.settings === true
        ? String(row.key)
        : map.settings.id
      : String(row[map.key]);
    const data = dataOf(map, row, roles[id] ?? []);
    return { id, data, revision: revisionOf(data), createdBy: null };
  });
}

/** One document, or null. */
export async function getDocument(
  ctx: QueryCtx,
  { collection, id }: { collection?: string; id?: string } = {},
) {
  const map = ownerMapping(ctx, collection);
  if (
    typeof id !== "string" ||
    (map.settings && map.settings !== true && id !== map.settings.id) ||
    // History's IDs are its row numbers.
    (map.generated && !/^\d{1,15}$/.test(id))
  )
    return null;
  const key = map.settings
    ? settingsKey(map, id)
    : map.generated
      ? Number(id)
      : id;
  const { rows } = await ctx.sql(
    `SELECT * FROM ${map.table} WHERE ${map.key} = ?`,
    [key],
  );
  return (await documentsOf(ctx, map, rows))[0] ?? null;
}
