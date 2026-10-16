// For the time being: the site's tables (the foundation's, the characters'
// and the economy's) read and written as the documents of the collections they
// replaced, for code not ported yet (the admin page, through the owner-only
// admin/documents query and mutation). It goes when the admin area is
// ported to its own mutations.
import { GROUP_ROLE, STAFF, parsed } from "./access.js";
import type { QueryCtx, SqlValue } from "./naru-types.js";

const P = "neo_avocado_";

/**
 * How a field is kept: text, a whole number, any finite number (`num`), a
 * 0/1 boolean, JSON, a flag (true as the time it was set), a row's number
 * shown as a string (`ref`), or a time in milliseconds written only with a
 * new row (`created`).
 */
type Kind =
  "text" | "int" | "num" | "bool" | "json" | "flag" | "ref" | "created";
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
  /**
   * The key is a row's number the table makes (inventory): a write naming
   * no row's number adds a row, one naming a row writes it.
   */
  numbered?: boolean;
  /** Members: role and groups are Naru roles. */
  roles?: boolean;
  /** The key also stands in the document (visits' day, profiles' owner). */
  keyField?: string;
  /** How lists are ordered. */
  order: string;
  /** The key is a row's number (characters), its ID the number as a string. */
  numeric?: boolean;
  /**
   * The row is another collection's too (a character's official record is
   * its sheet's row): a write changes only these columns of a row that
   * must exist, and there is no deleting it.
   */
  partial?: boolean;
  /**
   * The row counts its writes in `version`, the revision its own code
   * checks: a document's revision is it, and a write adds one.
   */
  versioned?: boolean;
  /** What a list or get selects besides the row's columns. */
  select?: string;
  /** Fields made from the row beyond its columns. */
  read?: (row: Record<string, SqlValue>, data: Record<string, any>) => void;
  /** Columns made from the document beyond its fields. */
  write?: (data: Record<string, any>, row: Record<string, SqlValue>) => void;
  /** Statements after a write (a character's titles). */
  after?: (key: SqlValue, data: Record<string, any>) => Statement[];
  /** Statements before a delete (a title leaves the characters holding it). */
  cascade?: (key: SqlValue) => Statement[];
}

/** One SQL statement and its values. */
export interface Statement {
  text: string;
  values: SqlValue[];
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
    // The characters' tables (0003_characters.sql).
    mapping(
      "characters",
      "characters",
      "id",
      [
        ["owner", "owner", "text", ""],
        ["name", "name", "text", ""],
        ["side", "side", "text", ""],
        ["class", "class", "text", ""],
        ["profile", "profile", "text", ""],
        ["type", "type", "text", "main"],
        ["state", "state", "text", "editing"],
        ["image", "image", "text", null],
        ["head", "head", "text", null],
        ["body", "body", "text", null],
        ["outfit", "outfit", "ref", null],
        ["fields", "fields", "json", "{}"],
        ["createdAt", "created_at", "created", 0],
      ],
      { numeric: true, versioned: true },
    ),
    mapping(
      "character_state",
      "characters",
      "id",
      [
        ["exp", "exp", "int", 0],
        ["points", "points", "int", null],
        ["stats", "stats", "json", "{}"],
        ["activeTitle", "active_title", "text", null],
        ["purchases", "purchases", "json", "{}"],
      ],
      {
        numeric: true,
        partial: true,
        versioned: true,
        select:
          "(SELECT json_group_array(title_id) FROM character_titles WHERE character_id = characters.id) AS titles",
        read(row, data) {
          data.owner = row.owner;
          data.character = String(row.id);
          data.approved = row.state === "approved";
          data.titles = parsed<string[]>(row.titles, []);
          if (row.explore_day)
            data.explore = { day: row.explore_day, count: row.explore_count };
        },
        write(data, row) {
          row.explore_day =
            typeof data.explore?.day === "string" ? data.explore.day : null;
          row.explore_count = Number.isSafeInteger(data.explore?.count)
            ? data.explore.count
            : 0;
        },
        after(key, data) {
          if (!Array.isArray(data.titles)) return [];
          const titles = [
            ...new Set(data.titles.filter((id) => typeof id === "string")),
          ] as string[];
          return [
            {
              text: "DELETE FROM character_titles WHERE character_id = ?",
              values: [key],
            },
            ...titles.map((title) => ({
              text: "INSERT INTO character_titles (character_id, title_id) VALUES (?, ?)",
              values: [key, title],
            })),
          ];
        },
      },
    ),
    ...["sides", "classes"].map((name) =>
      mapping(name, name, "id", [
        ["name", "name", "text", ""],
        ["image", "image", "text", null],
        ["level", "level", "int", 1],
        ["order", "sort_order", "int", 0],
      ]),
    ),
    mapping(
      "titles",
      "titles",
      "id",
      [
        ["name", "name", "text", ""],
        ["enabled", "enabled", "bool", 1],
        ["image", "image", "text", null],
        ["description", "description", "text", ""],
      ],
      {
        cascade: (key) => [
          {
            text: "DELETE FROM character_titles WHERE title_id = ?",
            values: [key],
          },
          {
            text: "UPDATE characters SET active_title = NULL WHERE active_title = ?",
            values: [key],
          },
        ],
      },
    ),
    mapping("couples", "couples", "id", [
      ["first", "first", "ref", 0],
      ["second", "second", "ref", 0],
      ["since", "since", "text", null],
      ["order", "sort_order", "int", 0],
    ]),
    mapping("character_fields", "character_fields", "id", [
      ["label", "label", "text", ""],
      ["type", "type", "text", "text"],
      ["options", "options", "json", "[]"],
      ["help", "help", "text", ""],
      ["suffix", "suffix", "text", ""],
      ["order", "sort_order", "int", 0],
      ["visibility", "visibility", "text", "public"],
      ["required", "required", "bool", 0],
    ]),
    mapping("stat_config", "stats", "id", [
      ["name", "name", "text", ""],
      ["initial", "initial", "int", 0],
      ["max", "max", "int", 999],
      ["min", "min", "int", 0],
      ["help", "help", "text", ""],
    ]),
    mapping("levels", "levels", "id", [
      ["name", "name", "text", ""],
      ["exp", "exp", "int", 0],
      ["bonusPoints", "bonus_points", "int", 0],
    ]),
    // The economy's tables (0004_economy.sql).
    mapping("items", "items", "id", [
      ["name", "name", "text", ""],
      ["description", "description", "text", ""],
      ["effectDescription", "effect_description", "text", ""],
      ["shopTalk", "shop_talk", "text", ""],
      ["image", "image", "text", null],
      ["shopCategory", "shop_category", "text", ""],
      ["display", "display", "json", null],
      ["price", "price", "int", 0],
      ["stock", "stock", "int", null],
      ["sellPrice", "sell_price", "int", null],
      ["order", "sort_order", "int", 0],
      ["hidden", "hidden", "bool", 0],
      ["sellable", "sellable", "bool", 1],
      ["giftable", "giftable", "bool", 1],
      ["usable", "usable", "bool", 1],
      ["usableInPosts", "usable_in_posts", "bool", 0],
      ["craftMaterial", "craft_material", "bool", 0],
      ["reusable", "reusable", "bool", 0],
      ["effect", "effect", "json", null],
      ["requirements", "requirements", "json", "{}"],
      ["useRequirements", "use_requirements", "json", "{}"],
      ["personal", "personal", "bool", 0],
    ]),
    // A gift's sender, senderName, memo and receivedAt (or the owner's
    // 지급 사유, memo) are its gift JSON.
    mapping(
      "inventory",
      "inventory",
      "id",
      [
        ["owner", "owner", "text", ""],
        ["item", "item_id", "text", ""],
        ["name", "name", "text", ""],
        ["from", "origin", "text", ""],
        ["character", "character_id", "ref", null],
      ],
      { extra: "gift", numbered: true },
    ),
    mapping(
      "recipes",
      "recipes",
      "id",
      [
        ["name", "name", "text", ""],
        ["description", "description", "text", ""],
        ["item", "item_id", "text", ""],
        ["cost", "cost", "int", 0],
        ["hidden", "hidden", "bool", 0],
      ],
      {
        select:
          "(SELECT json_group_array(json_object('item', item_id, 'count', count)) FROM recipe_ingredients WHERE recipe_id = recipes.id) AS ingredients",
        read(row, data) {
          data.ingredients = parsed(row.ingredients, []);
        },
        after(key, data) {
          const seen = new Set();
          const ingredients = (
            Array.isArray(data.ingredients) ? data.ingredients : []
          ).filter(
            (entry) =>
              typeof entry?.item === "string" &&
              Number.isSafeInteger(entry.count) &&
              entry.count > 0 &&
              !seen.has(entry.item) &&
              seen.add(entry.item),
          );
          return [
            {
              text: "DELETE FROM recipe_ingredients WHERE recipe_id = ?",
              values: [key],
            },
            ...ingredients.map((entry) => ({
              text: "INSERT INTO recipe_ingredients (recipe_id, item_id, count) VALUES (?, ?, ?)",
              values: [key, entry.item, entry.count],
            })),
          ];
        },
        cascade: (key) => [
          {
            text: "DELETE FROM recipe_ingredients WHERE recipe_id = ?",
            values: [key],
          },
        ],
      },
    ),
    mapping("gacha", "gacha", "id", [
      ["source", "source", "text", null],
      ["item", "item_id", "text", null],
      ["weight", "weight", "num", 1],
    ]),
    mapping("explore", "explore", "id", [
      ["item", "item_id", "text", null],
      ["weight", "weight", "num", 1],
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
    if (kind === "created") {
      row[column] = now;
      continue;
    }
    if (kind === "ref") {
      const number = typeof value === "number" ? value : Number(value);
      row[column] =
        value !== null && value !== "" && Number.isSafeInteger(number)
          ? number
          : fallback;
      continue;
    }
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
              : kind === "num"
                ? typeof value === "number" && Number.isFinite(value)
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
  map.write?.(data ?? {}, row);
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
    if (value === null || value === undefined || kind === "created") continue;
    data[field] =
      kind === "ref"
        ? String(value)
        : kind === "bool" || kind === "flag"
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
  map.read?.(row, data);
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
    const created = map.columns.find(([, , kind]) => kind === "created");
    return {
      id,
      data,
      revision: map.versioned ? String(row.version) : revisionOf(data),
      createdBy: null,
      ...(created
        ? { createdAt: new Date(Number(row[created[1]])).toISOString() }
        : {}),
    };
  });
}

/**
 * A document ID's key in its table: a settings row's key, a row's number
 * (history, characters), or the ID itself; null when it names no row.
 */
export function keyOf(map: Mapping, id: unknown): SqlValue {
  if (typeof id !== "string") return null;
  if (map.settings)
    return map.settings !== true && id !== map.settings.id
      ? null
      : settingsKey(map, id);
  if (map.generated || map.numeric || map.numbered)
    return /^[1-9]\d{0,14}$/.test(id) ? Number(id) : null;
  return id;
}

/** The SELECT reading a mapping's rows, before any WHERE. */
export const selectOf = (map: Mapping) =>
  `SELECT *${map.select ? `, ${map.select}` : ""} FROM ${map.table}`;

/**
 * The statements that write a document's data to its row: an upsert (only
 * an update of a `partial` row, which must exist), then the mapping's own.
 * A table that numbers its rows (history) always adds one.
 */
export function writeStatements(
  map: Mapping,
  key: SqlValue,
  data: Record<string, any>,
  now: number,
): { write: Statement; after: Statement[] } {
  const row = rowOf(map, data, now);
  const inserted = new Set(
    map.columns.filter(([, , kind]) => kind === "created").map(([, c]) => c),
  );
  const columns = Object.keys(row);
  const values: SqlValue[] = Object.values(row);
  const updated = columns.filter((column) => !inserted.has(column));
  let write: Statement;
  if (map.generated || (map.numbered && key === null))
    write = {
      text: `INSERT INTO ${map.table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING *`,
      values,
    };
  else if (map.partial)
    write = {
      text: `UPDATE ${map.table} SET ${updated.map((column) => `${column} = ?`).join(", ")}${map.versioned ? ", version = version + 1" : ""} WHERE ${map.key} = ? RETURNING *`,
      values: [...updated.map((column) => row[column]), key],
    };
  else
    write = {
      text: `INSERT INTO ${map.table} (${map.key}, ${columns.join(", ")}) VALUES (?, ${columns.map(() => "?").join(", ")})
     ON CONFLICT (${map.key}) DO UPDATE SET ${updated.map((column) => `${column} = excluded.${column}`).join(", ")}${map.versioned ? `, version = ${map.table}.version + 1` : ""}
     RETURNING *`,
      values: [key, ...values],
    };
  return { write, after: map.after?.(key, data) ?? [] };
}

/** One document, or null. */
export async function getDocument(
  ctx: QueryCtx,
  { collection, id }: { collection?: string; id?: string } = {},
) {
  const map = ownerMapping(ctx, collection);
  const key = keyOf(map, id);
  if (key === null) return null;
  const { rows } = await ctx.sql(`${selectOf(map)} WHERE ${map.key} = ?`, [
    key,
  ]);
  return (await documentsOf(ctx, map, rows))[0] ?? null;
}
