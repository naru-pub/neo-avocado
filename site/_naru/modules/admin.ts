// The owner's admin (admin/): each section's rows as its forms read them
// ({ id, data }), and saves checked with the section's model
// (admin-model.ts's buildRecord, as the page used to check them) before they
// are written to the section's table. The queries and mutations in admin/
// are the owner's alone: each is made by `ownerOnly` (access.ts).
import { buildRecord, formValues, models } from "./admin-model.js";
import {
  GROUP_ROLE,
  STAFF,
  accessOfRoles,
  containing,
  one,
  parsed,
  requireOwner,
  invalid,
} from "./access.js";
import { characterKey } from "./characters.js";
import { RECORD_CALLS, type AdminCall } from "./admin-calls.js";
import type { MutationCtx, QueryCtx, SqlValue } from "./naru-types.js";

/** Refuses input no form sends. */
export { invalid };

/** A save made from a row someone else changed or removed meanwhile. */
export function conflict(ctx: QueryCtx): never {
  return ctx.fail(
    "CONFLICT",
    "다른 곳에서 수정되었습니다. 새로고침 후 다시 수정해 주세요.",
    { reason: "conflict" },
  );
}

/**
 * How a form field is kept: text (an empty one as NULL where the column
 * allows it), a whole number, any finite number (`num`), a 0/1 boolean,
 * JSON, or a row's number shown as a string (`ref`).
 */
type Kind = "text" | "int" | "num" | "bool" | "json" | "ref";
/** A form field, its column, how it is kept, and the column's value when the field is missing. */
type Column = readonly [
  field: string,
  column: string,
  kind: Kind,
  fallback: SqlValue,
];

/** A section's table. */
interface Table {
  table: string;
  /** The key column; a row's ID. */
  key: string;
  columns: Column[];
  /** The JSON column keeping the form's fields without columns of their own. */
  extra?: string;
  /** The key is a row number the table makes (inventory). */
  numbered?: boolean;
  /** Its rows keep when they were made (created_at), the order of a tie. */
  stamped?: boolean;
  /** What a read selects besides the row's columns. */
  select?: string;
  /** Fields made from the row beyond its columns. */
  read?: (row: Record<string, SqlValue>, data: Record<string, any>) => void;
}

const table = (
  name: string,
  columns: Column[],
  rest: Partial<Table> = {},
): Table => ({ table: name, key: "id", columns, ...rest });

/** The sections kept one row each in a table of their own, by section. */
export const TABLES: Record<string, Table> = {
  members: table(
    "members",
    [
      ["level", "level", "int", 2],
      ["adult", "adult", "bool", 0],
      ["warnings", "warnings", "int", 0],
      ["warningNote", "warning_note", "text", ""],
      ["left", "left_on", "text", null],
      ["blocked", "blocked_on", "text", null],
      ["note", "note", "text", ""],
      ["agreedAt", "agreed_at", "int", null],
      ["requestedAt", "requested_at", "int", null],
    ],
    { key: "member" },
  ),
  wallets: table(
    "wallets",
    [
      ["balance", "balance", "int", 0],
      ["lastDaily", "last_daily", "text", null],
    ],
    { key: "member" },
  ),
  content: table("content", [
    ["name", "name", "text", ""],
    ["enabled", "enabled", "bool", 1],
    ["readLevel", "read_level", "int", 1],
    ["format", "format", "text", "html"],
    ["body", "body", "text", ""],
    ["mobileBody", "mobile_body", "text", ""],
    ["headerImage", "header_image", "text", null],
    ["footerImage", "footer_image", "text", null],
  ]),
  menus: table(
    "menus",
    [
      ["name", "name", "text", ""],
      ["link", "link", "text", ""],
      ["parent", "parent", "text", null],
      ["order", "sort_order", "int", 0],
      ["level", "level", "int", 1],
      ["enabled", "enabled", "bool", 1],
      ["mobile", "mobile", "bool", 1],
      ["newWindow", "new_window", "bool", 0],
    ],
    { stamped: true },
  ),
  banners: table(
    "banners",
    [
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
    ],
    { stamped: true },
  ),
  // 팝업레이어 and 설문조사.
  popups: table(
    "popups",
    [
      ["subject", "subject", "text", ""],
      ["content", "content", "text", ""],
      ["device", "device", "text", "both"],
      ["startsAt", "starts_at", "text", null],
      ["endsAt", "ends_at", "text", null],
      ["disableHours", "disable_hours", "int", 24],
      ["left", "left_px", "int", 10],
      ["top", "top_px", "int", 10],
      ["width", "width_px", "int", 450],
      ["height", "height_px", "int", 500],
      ["enabled", "enabled", "bool", 1],
    ],
    { stamped: true },
  ),
  polls: table("polls", [
    ["subject", "subject", "text", ""],
    ["options", "options", "text", ""],
    ["level", "level", "int", 2],
    ["point", "point", "int", 0],
    ["etc", "etc", "text", ""],
    ["createdAt", "created_at", "int", 0],
    ["enabled", "enabled", "bool", 1],
  ]),
  quests: table("quests", [
    ["name", "name", "text", ""],
    ["type", "type", "text", "daily"],
    ["side", "side", "text", ""],
    ["startsAt", "starts_at", "text", null],
    ["endsAt", "ends_at", "text", null],
    ["images", "images", "json", "[]"],
  ]),
  boards: table(
    "boards",
    [
      ["name", "name", "text", ""],
      ["group", "group_id", "text", null],
      ["kind", "kind", "text", "image"],
      ["enabled", "enabled", "bool", 1],
      ["listLevel", "list_level", "int", 2],
      ["readLevel", "read_level", "int", 2],
      ["writeLevel", "write_level", "int", 2],
      ["commentLevel", "comment_level", "int", 2],
      ["anonymous", "anonymous", "bool", 0],
      ["secret", "secret", "text", "optional"],
      ["writeReward", "write_reward", "int", 0],
      ["commentReward", "comment_reward", "int", 0],
      ["writeMin", "write_min", "int", 0],
      ["writeMax", "write_max", "int", 0],
      ["commentMin", "comment_min", "int", 0],
      ["commentMax", "comment_max", "int", 0],
      ["editLock", "edit_lock", "int", 1],
      ["pageRows", "page_rows", "int", 15],
      ["foldHeight", "fold_height", "int", 600],
      ["admin", "admin", "text", null],
      // 출력 순서 (bo_order): the boards' order, before their IDs.
      ["order", "sort_order", "int", 0],
    ],
    { extra: "options" },
  ),
  board_groups: table("board_groups", [
    ["name", "name", "text", ""],
    ["admin", "admin", "text", null],
    ["membersOnly", "members_only", "bool", 0],
    ["order", "sort_order", "int", 0],
  ]),
  emoticons: table(
    "emoticons",
    [
      ["name", "name", "text", ""],
      ["image", "image", "text", ""],
    ],
    { stamped: true },
  ),
  sides: table("sides", [
    ["name", "name", "text", ""],
    ["image", "image", "text", null],
    ["level", "level", "int", 1],
    ["order", "sort_order", "int", 0],
  ]),
  classes: table("classes", [
    ["name", "name", "text", ""],
    ["image", "image", "text", null],
    ["level", "level", "int", 1],
    ["order", "sort_order", "int", 0],
  ]),
  titles: table("titles", [
    ["name", "name", "text", ""],
    ["enabled", "enabled", "bool", 1],
    ["image", "image", "text", null],
    ["description", "description", "text", ""],
  ]),
  couples: table(
    "couples",
    [
      ["first", "first", "ref", 0],
      ["second", "second", "ref", 0],
      ["since", "since", "text", null],
      ["order", "sort_order", "int", 0],
    ],
    {
      // couple_list.php's two characters, by name.
      select:
        "(SELECT name FROM characters WHERE id = couples.first) AS first_name, (SELECT name FROM characters WHERE id = couples.second) AS second_name",
      read(row, data) {
        data.firstName = row.first_name ?? "";
        data.secondName = row.second_name ?? "";
      },
    },
  ),
  character_fields: table("character_fields", [
    ["label", "label", "text", ""],
    ["type", "type", "text", "text"],
    ["options", "options", "json", "[]"],
    ["help", "help", "text", ""],
    ["suffix", "suffix", "text", ""],
    ["order", "sort_order", "int", 0],
    ["visibility", "visibility", "text", "public"],
    ["required", "required", "bool", 0],
    ["size", "size", "int", 0],
  ]),
  stat_config: table("stats", [
    ["name", "name", "text", ""],
    ["initial", "initial", "int", 0],
    ["max", "max", "int", 999],
    ["min", "min", "int", 0],
    ["help", "help", "text", ""],
    ["order", "sort_order", "int", 0],
    ["useMax", "use_max", "bool", 0],
  ]),
  levels: table("levels", [
    ["name", "name", "text", ""],
    ["exp", "exp", "int", 0],
    ["bonusPoints", "bonus_points", "int", 0],
  ]),
  items: table("items", [
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
    ["category", "category", "text", "general"],
    ["detailImage", "detail_image", "text", null],
    ["itemType", "item_type", "text", ""],
  ]),
  // 상점 진열: an item's further sales.
  shop_entries: table(
    "shop_entries",
    [
      ["item", "item_id", "text", ""],
      ["enabled", "enabled", "bool", 1],
      ["shopCategory", "shop_category", "text", ""],
      ["shopTalk", "shop_talk", "text", ""],
      ["display", "display", "json", null],
      ["price", "price", "int", 0],
      ["stock", "stock", "int", null],
      ["order", "sort_order", "int", 0],
      ["requirements", "requirements", "json", "{}"],
    ],
    {
      // shop_list.php's 아이템, by name.
      select:
        "(SELECT name FROM items WHERE id = shop_entries.item_id) AS item_name",
      read(row, data) {
        data.itemName = row.item_name ?? "";
      },
    },
  ),
  // A grant's 지급 사유 (memo), and a gift's sender and memo, are its gift JSON.
  inventory: table(
    "inventory",
    [
      ["owner", "owner", "text", ""],
      ["item", "item_id", "text", ""],
      ["name", "name", "text", ""],
      ["from", "origin", "text", ""],
      ["character", "character_id", "ref", null],
    ],
    { extra: "gift", numbered: true },
  ),
  recipes: table(
    "recipes",
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
    },
  ),
  gacha: table(
    "gacha",
    [
      ["source", "source", "text", null],
      ["item", "item_id", "text", null],
      ["weight", "weight", "num", 1],
    ],
    {
      // explorer_list.php's 뽑기 아이템 and 획득 아이템, by name.
      select:
        "(SELECT name FROM items WHERE id = gacha.source) AS source_name, (SELECT name FROM items WHERE id = gacha.item_id) AS item_name",
      read(row, data) {
        data.sourceName = row.source_name ?? "";
        data.itemName = row.item_name ?? "";
      },
    },
  ),
  explore: table(
    "explore",
    [
      ["item", "item_id", "text", null],
      ["weight", "weight", "num", 1],
    ],
    {
      select:
        "(SELECT name FROM items WHERE id = explore.item_id) AS item_name",
      read(row, data) {
        data.itemName = row.item_name ?? "";
      },
    },
  ),
};

/** `section`, if it answers `call` here; refused otherwise. */
export function recordSection(
  ctx: QueryCtx,
  section: unknown,
  call: AdminCall,
): string {
  if (
    typeof section !== "string" ||
    !Object.hasOwn(RECORD_CALLS, section) ||
    !RECORD_CALLS[section].includes(call)
  )
    invalid(ctx);
  return section as string;
}

/** The settings sections, one JSON row each, by section: their row's key. */
export const SETTINGS: Record<string, string> = {
  settings: "community",
  design: "design",
  character_images: "profile",
};

/** The table of a section kept in one, for the owner only. */
export function tableOf(ctx: QueryCtx, section: string): Table {
  requireOwner(ctx);
  if (!Object.hasOwn(TABLES, section)) invalid(ctx);
  return TABLES[section];
}

/** An empty field reads as none, as a record without it. */
const empty = (value: unknown) =>
  value === undefined || value === null || value === "";

/** The column values a record's data keeps, by column. */
export function rowOf(t: Table, data: Record<string, any>) {
  const row: Record<string, SqlValue> = {};
  for (const [field, column, kind, fallback] of t.columns) {
    const value = data?.[field];
    if (kind === "ref") {
      const number = typeof value === "number" ? value : Number(value);
      row[column] =
        !empty(value) && Number.isSafeInteger(number) ? number : fallback;
    } else if (kind === "bool")
      row[column] =
        value === undefined || value === null ? fallback : value ? 1 : 0;
    else if (kind === "json")
      row[column] =
        value === undefined || value === null
          ? fallback
          : JSON.stringify(value);
    else if (kind === "int")
      row[column] = Number.isSafeInteger(value) ? value : fallback;
    else if (kind === "num")
      row[column] =
        typeof value === "number" && Number.isFinite(value) ? value : fallback;
    else
      row[column] =
        empty(value) && fallback === null
          ? null
          : typeof value === "string"
            ? value
            : (fallback as string | null);
  }
  if (t.extra) {
    const known = new Set(t.columns.map(([field]) => field));
    const extra = {};
    for (const [key, value] of Object.entries(data ?? {}))
      if (!known.has(key) && value !== undefined) extra[key] = value;
    row[t.extra] = JSON.stringify(extra);
  }
  return row;
}

/** A row as its record's data. */
export function dataOf(t: Table, row: Record<string, SqlValue>) {
  const data: Record<string, any> = t.extra ? parsed(row[t.extra], {}) : {};
  for (const [field, column, kind, fallback] of t.columns) {
    const value = row[column];
    if (value === null || value === undefined) continue;
    data[field] =
      kind === "ref"
        ? String(value)
        : kind === "bool"
          ? value !== 0
          : kind === "json"
            ? parsed(value, fallback === "[]" ? [] : {})
            : value;
  }
  t.read?.(row, data);
  return data;
}

/** A section's row as a record: { id, data }. */
export const recordOf = (t: Table, row: Record<string, SqlValue>) => ({
  id: String(row[t.key]),
  data: dataOf(t, row),
});

/** A row's key from a record's ID, or null when it names none. */
export function keyOf(t: Table, id: unknown): SqlValue {
  if (typeof id !== "string" || !id) return null;
  if (t.numbered) return /^[1-9]\d{0,14}$/.test(id) ? Number(id) : null;
  return id;
}

/** The SELECT reading a section's rows, before any WHERE. */
export const selectOf = (t: Table) =>
  `SELECT *${t.select ? `, ${t.select}` : ""} FROM ${t.table}`;

/** A row by its record's ID, or null. */
export async function rowById(ctx: QueryCtx, t: Table, id: unknown) {
  const key = keyOf(t, id);
  if (key === null) return null;
  return await one(ctx, `${selectOf(t)} WHERE ${t.key} = ?`, [key]);
}

/** Each page of a section's list. */
export const PAGE = 50;

/** A page offset from a list's cursor. */
export function offsetOf(ctx: QueryCtx, after: unknown): number {
  const offset = after === null || after === undefined ? 0 : Number(after);
  if (!Number.isSafeInteger(offset) || offset < 0) invalid(ctx);
  return offset;
}

/** A page of `rows` read with LIMIT PAGE + 1 OFFSET `offset`. */
export const pageOf = <T>(rows: T[], offset: number) => ({
  documents: rows.slice(0, PAGE),
  nextCursor: rows.length > PAGE ? String(offset + PAGE) : null,
});

/**
 * A section's rows a page at a time: { documents, nextCursor }. In its 순서
 * (sort_order) where it keeps one, as couple_list.php reads co_order, else
 * by key; or by `sort`, one of its fields, as a list's column headings
 * sort (subject_sort_link), `desc` for the other way. `filter` narrows to
 * rows whose field holds a value (quest_list.php's 세력, a 배너's place).
 */
export async function listRecords(
  ctx: QueryCtx,
  section: string,
  {
    after = null,
    search = "",
    sort = null,
    desc = false,
    filter = null,
  }: {
    after?: string | null;
    search?: string;
    sort?: string | null;
    desc?: boolean;
    filter?: { field?: string; value?: string } | null;
  } = {},
) {
  const t = tableOf(ctx, section);
  const offset = offsetOf(ctx, after);
  if (typeof search !== "string" || search.length > 40) invalid(ctx);
  const columnOf = (field: unknown) =>
    t.columns.find(
      ([name, , kind]) => name === field && kind !== "json",
    )?.[1] ?? null;
  const sortColumn = sort === null ? null : columnOf(sort);
  if ((sort !== null && !sortColumn) || typeof desc !== "boolean") invalid(ctx);
  const filterColumn = filter === null ? null : columnOf(filter?.field);
  if (
    filter !== null &&
    (!filterColumn ||
      typeof filter.value !== "string" ||
      filter.value.length > 64)
  )
    invalid(ctx);
  // The lists' 검색 (board_list.php's bo_table and bo_subject, quest_list's
  // title, boardgroup_list's gr_id and gr_subject…): the ID or name holding it.
  const named = [
    t.key,
    ...t.columns
      .filter(
        ([field, , kind]) =>
          kind === "text" && ["name", "title", "label", "alt"].includes(field),
      )
      .map(([, column]) => column),
  ];
  // An item a row names is found by its name too (explorer_list.php's
  // sch_it_id).
  const items = t.columns
    .filter(([field]) => field === "item" || field === "source")
    .map(([, column]) => column);
  const term = search.trim();
  const clauses: string[] = [];
  const values: SqlValue[] = [];
  if (term) {
    clauses.push(
      `(${[
        ...named.map((column) => `CAST(${column} AS TEXT) LIKE ? ESCAPE '\\'`),
        ...items.map(
          (column) =>
            `${column} IN (SELECT id FROM items WHERE name LIKE ? ESCAPE '\\' LIMIT 100)`,
        ),
      ].join(" OR ")})`,
    );
    values.push(...[...named, ...items].map(() => containing(term)));
  }
  if (filterColumn) {
    clauses.push(`${filterColumn} = ?`);
    values.push(filter.value);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const ordered = t.columns.find(([field]) => field === "order")?.[1];
  const order = sortColumn
    ? `${sortColumn} ${desc ? "DESC" : "ASC"}, ${t.key}`
    : ordered
      ? `${ordered}, ${t.key}`
      : t.key;
  const { rows } = await ctx.sql(
    `${selectOf(t)}${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...values, PAGE + 1, offset],
  );
  return pageOf(
    rows.map((row) => recordOf(t, row)),
    offset,
  );
}

/** One of a section's records, or null. */
export async function getRecord(
  ctx: QueryCtx,
  section: string,
  { id }: { id?: string } = {},
) {
  const t = tableOf(ctx, section);
  const row = await rowById(ctx, t, id);
  return row ? recordOf(t, row) : null;
}

/**
 * Up to `limit` rows of `select` (a SELECT without WHERE or ORDER BY), in
 * the order of `keys`, columns it selects that together name a row: read
 * 1,000 at a time, each page after the last one's keys (keyset paging, so
 * no page reads the rows before it again).
 */
export async function allRows(
  ctx: QueryCtx,
  select: string,
  keys: string[] = ["id"],
  limit = 20000,
) {
  const rows: Record<string, SqlValue>[] = [];
  const order = `ORDER BY ${keys.join(", ")} LIMIT 1000`;
  const after = `WHERE (${keys.join(", ")}) > (${keys.map(() => "?").join(", ")})`;
  while (rows.length < limit) {
    const last = rows.at(-1);
    const page = (
      await ctx.sql(
        `${select} ${last ? after : ""} ${order}`,
        last ? keys.map((key) => last[key]) : [],
      )
    ).rows;
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

/** A form's pick lists, as `buildRecord` and the page read them: { id, data }. */
export type References = Record<string, { id: string; data: any }[]>;

/** The owner's lists the forms pick from, those named. */
export async function catalogues(
  ctx: QueryCtx,
  names: string[],
): Promise<References> {
  const references: References = {};
  const read = async (
    name: string,
    text: string,
    data: (row) => any,
    keys = ["id"],
  ) => {
    if (names.includes(name))
      references[name] = (await allRows(ctx, text, keys)).map((row) => ({
        id: String(row.id),
        data: data(row),
      }));
  };
  await read("titles", "SELECT id, name, image FROM titles", (row) => ({
    name: row.name,
    image: row.image,
  }));
  await read("stats", "SELECT id, name, initial, max FROM stats", (row) => ({
    name: row.name,
    initial: row.initial,
    max: row.max,
  }));
  await read("items", "SELECT id, name, craft_material FROM items", (row) => ({
    name: row.name,
    craftMaterial: row.craft_material === 1,
  }));
  for (const name of ["sides", "classes"])
    await read(
      name,
      `SELECT id, name, sort_order FROM ${name}`,
      (row) => ({ name: row.name, order: row.sort_order }),
      ["sort_order", "id"],
    );
  await read("boards", "SELECT id, name FROM boards", (row) => ({
    name: row.name,
  }));
  await read(
    "groups",
    "SELECT id, name, sort_order FROM board_groups",
    (row) => ({ name: row.name }),
    ["sort_order", "id"],
  );
  await read(
    "recipes",
    "SELECT id, name, (SELECT json_group_array(json_object('item', item_id, 'count', count)) FROM recipe_ingredients WHERE recipe_id = recipes.id) AS ingredients FROM recipes",
    (row) => ({ name: row.name, ingredients: parsed(row.ingredients, []) }),
  );
  await read("characters", "SELECT id, owner, name FROM characters", (row) => ({
    name: row.name,
    owner: row.owner,
  }));
  if (names.includes("profiles"))
    references.profiles = (
      await allRows(ctx, "SELECT member, nick FROM profiles", ["member"])
    ).map((row) => ({ id: String(row.member), data: { nick: row.nick } }));
  return references;
}

/** The catalogues each section's checks pick from. */
const NEEDS: Record<string, string[]> = {
  items: ["stats", "titles", "items"],
  shop_entries: ["stats", "titles", "items"],
  recipes: ["items", "recipes"],
  gacha: ["items"],
  explore: ["items"],
  inventory: ["items"],
  quests: ["sides"],
  boards: ["groups", "profiles"],
  board_groups: ["profiles"],
  members: ["groups"],
  character_state: ["stats", "titles"],
  stat_config: ["stats"],
};

/** The characters and members `values` name (couples, inventory, records, wallets). */
async function named(
  ctx: QueryCtx,
  section: string,
  id: string,
  values: Record<string, unknown>,
  references: References,
) {
  const characters = [
    ...(section === "couples" ? [values.first, values.second] : []),
    ...(section === "inventory" ? [values.character] : []),
    ...(section === "character_state" ? [id] : []),
  ]
    .map(characterKey)
    .filter((key) => key !== null);
  // Added to a catalogue the section read whole, if it did.
  references.characters = references.characters ?? [];
  for (const key of new Set(characters)) {
    const row = await one(
      ctx,
      "SELECT id, owner, name FROM characters WHERE id = ?",
      [key],
    );
    if (row)
      references.characters.push({
        id: String(row.id),
        data: { name: row.name, owner: row.owner },
      });
  }
  const members = [
    ...(section === "inventory" ? [values.owner] : []),
    ...(section === "wallets" ? [id] : []),
  ].filter((member) => typeof member === "string" && member);
  references.profiles = references.profiles ?? [];
  for (const member of new Set(members)) {
    const row = await one(
      ctx,
      "SELECT member, nick FROM profiles WHERE member = ?",
      [member as string],
    );
    if (row)
      references.profiles.push({
        id: String(row.member),
        data: { nick: row.nick },
      });
  }
}

/**
 * What a section's form sent, checked as the form checks it: `values` over
 * the current record's (or a new one's defaults), through the section's
 * model. Answers the record to keep, or refuses with the check's message.
 */
export async function checked(
  ctx: QueryCtx,
  section: string,
  {
    id,
    values,
    current,
  }: {
    id: string;
    values: unknown;
    current: { id?: string; data: Record<string, any> } | null;
  },
): Promise<{ id: string; data: Record<string, any> }> {
  if (!values || typeof values !== "object" || Array.isArray(values))
    invalid(ctx);
  const references = await catalogues(ctx, NEEDS[section] ?? []);
  const merged = {
    ...formValues(section, current?.data ?? null, references),
    ...(values as Record<string, unknown>),
    id,
  };
  await named(ctx, section, id, merged, references);
  try {
    return buildRecord(section, merged, current, references);
  } catch (error) {
    return ctx.fail(
      "INVALID_REQUEST",
      String(error?.message ?? "입력 내용을 확인해 주세요."),
      { reason: "invalid_input" },
    );
  }
}

/** A member's roles after their record is saved: its role and groups, the others kept. */
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

/** Gives a member these roles, unless they have them already. */
export async function setRolesOf(
  ctx: MutationCtx,
  member: string,
  roles: string[],
) {
  const before = [...((await ctx.rolesOf([member]))[member] ?? [])].sort();
  if (roles.join() !== before.join()) await ctx.setRoles(member, roles);
}

/** A member's record: the row's fields, with the role and groups their Naru roles give. */
export const memberData = (
  row: Record<string, SqlValue> | null,
  roles: readonly string[],
) => ({
  ...(row ? dataOf(TABLES.members, row) : {}),
  ...accessOfRoles(roles),
});

/** Writes a record's data to its row: an upsert, or a new numbered row. */
export async function writeRow(
  ctx: MutationCtx,
  t: Table,
  key: SqlValue,
  data: Record<string, any>,
): Promise<Record<string, SqlValue>> {
  const row = rowOf(t, data);
  const columns = Object.keys(row);
  const values = Object.values(row);
  if (t.numbered && key === null)
    return (
      await ctx.sql(
        `INSERT INTO ${t.table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING *`,
        values,
      )
    ).rows[0];
  if (t.numbered)
    return (
      await ctx.sql(
        `UPDATE ${t.table} SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE ${t.key} = ? RETURNING *`,
        [...values, key],
      )
    ).rows[0];
  // A stamped row keeps the time it was first written.
  const made = t.stamped ? ["created_at"] : [];
  return (
    await ctx.sql(
      `INSERT INTO ${t.table} (${[t.key, ...made, ...columns].join(", ")})
       VALUES (${[key, ...made, ...columns].map(() => "?").join(", ")})
       ON CONFLICT (${t.key}) DO UPDATE SET ${columns.map((column) => `${column} = excluded.${column}`).join(", ")}
       RETURNING *`,
      [key, ...made.map(() => ctx.now), ...values],
    )
  ).rows[0];
}

/**
 * Saves one of a section's records from its form's `values`: a new one
 * (`create`, refused if its ID is taken) or the one `id` names (refused if
 * it is gone). Answers the saved record.
 */
export async function saveRecord(
  ctx: MutationCtx,
  section: string,
  {
    id,
    values,
    create = false,
  }: { id?: string; values?: unknown; create?: boolean } = {},
) {
  const t = tableOf(ctx, section);
  if (typeof id !== "string" || !id) invalid(ctx);
  const key = create && t.numbered ? null : keyOf(t, id);
  const before = key === null ? null : await rowById(ctx, t, id);
  if (create ? before : !before) conflict(ctx);
  const record = await checked(ctx, section, {
    id,
    values,
    current: before ? recordOf(t, before) : null,
  });
  // 메뉴: two levels, as me_code's are; a parent is a top-level menu, and
  // a menu with its own under it stays at the top.
  if (section === "menus" && record.data.parent) {
    const parent = await one<{ parent: string | null }>(
      ctx,
      "SELECT parent FROM menus WHERE id = ?",
      [record.data.parent],
    );
    if (
      !parent ||
      parent.parent ||
      (await one(ctx, "SELECT 1 FROM menus WHERE parent = ?", [id]))
    )
      ctx.fail(
        "INVALID_REQUEST",
        "상위 메뉴는 하위 메뉴가 없는 최상위 메뉴여야 합니다.",
        {
          reason: "invalid_input",
        },
      );
  }
  // 설문조사: made at the call's time.
  if (section === "polls" && !before) record.data.createdAt = ctx.now;
  const saved = await writeRow(ctx, t, key, record.data);
  if (section === "recipes") await saveIngredients(ctx, record);
  // 소속 and 종족 are kept by name: a rename carries over to what has it.
  if ((section === "sides" || section === "classes") && before)
    await renameChoice(
      ctx,
      section === "sides" ? "side" : "class",
      String(before.name ?? ""),
      String(saved.name ?? ""),
    );
  return recordOf(t, (await rowById(ctx, t, String(saved[t.key]))) ?? saved);
}

/** A recipe's materials, rows of their own: replaced by the form's. */
async function saveIngredients(
  ctx: MutationCtx,
  { id, data }: { id: string; data: Record<string, any> },
) {
  await ctx.sql`DELETE FROM recipe_ingredients WHERE recipe_id = ${id}`;
  for (const entry of data.ingredients ?? [])
    await ctx.sql`INSERT INTO recipe_ingredients (recipe_id, item_id, count) VALUES (${id}, ${entry.item}, ${entry.count})`;
}

/**
 * A 소속's or 종족's new name, on the characters, quests and shop and use
 * restrictions that had the old one.
 */
async function renameChoice(
  ctx: MutationCtx,
  field: "side" | "class",
  from: string,
  to: string,
) {
  if (!from || from === to) return;
  await ctx.sql(`UPDATE characters SET ${field} = ? WHERE ${field} = ?`, [
    to,
    from,
  ]);
  if (field === "side")
    await ctx.sql`UPDATE quests SET side = ${to} WHERE side = ${from}`;
  const key = field === "side" ? "sides" : "classes";
  for (const [table, columns] of [
    ["items", ["requirements", "use_requirements"]],
    ["shop_entries", ["requirements"]],
  ] as const)
    for (const column of columns) {
      const { rows } = await ctx.sql<{ id: string; value: string }>(
        `SELECT id, ${column} AS value FROM ${table}
         WHERE EXISTS (SELECT 1 FROM json_each(${table}.${column}, '$.${key}') WHERE value = ?)`,
        [from],
      );
      for (const row of rows) {
        const value = parsed<Record<string, any>>(row.value, {});
        value[key] = (value[key] as string[]).map((name) =>
          name === from ? to : name,
        );
        await ctx.sql(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, [
          JSON.stringify(value),
          row.id,
        ]);
      }
    }
}

/**
 * Deletes one of a section's records; one already gone is fine. An item
 * takes its copies, listings, draws and the recipes that make or need it
 * with it (adm/item_list_update.php); a board group still holding boards
 * is kept (boardgroup_list_update.php), and one deleted takes its members'
 * group-<id> roles.
 */
export async function removeRecord(
  ctx: MutationCtx,
  section: string,
  { id }: { id?: string } = {},
) {
  const t = tableOf(ctx, section);
  const key = keyOf(t, id);
  if (key === null) invalid(ctx);
  if (section === "recipes")
    await ctx.sql`DELETE FROM recipe_ingredients WHERE recipe_id = ${key}`;
  if (section === "items") {
    await ctx.sql`DELETE FROM inventory WHERE item_id = ${key}`;
    await ctx.sql`DELETE FROM shop_entries WHERE item_id = ${key}`;
    await ctx.sql`DELETE FROM gacha WHERE item_id = ${key} OR source = ${key}`;
    await ctx.sql`DELETE FROM explore WHERE item_id = ${key}`;
    const { rows: recipes } = await ctx.sql<{ id: string }>`
      SELECT id FROM recipes WHERE item_id = ${key}
      UNION SELECT recipe_id FROM recipe_ingredients WHERE item_id = ${key}`;
    const gone = JSON.stringify(recipes.map((row) => row.id));
    await ctx.sql`DELETE FROM recipe_ingredients WHERE recipe_id IN (SELECT value FROM json_each(${gone}))`;
    await ctx.sql`DELETE FROM recipes WHERE id IN (SELECT value FROM json_each(${gone}))`;
  }
  // poll_delete.php: its votes and 기타의견 go with it.
  if (section === "polls") {
    await ctx.sql`DELETE FROM poll_votes WHERE poll_id = ${key}`;
    await ctx.sql`DELETE FROM poll_comments WHERE poll_id = ${key}`;
  }
  if (section === "board_groups") {
    if (await one(ctx, "SELECT 1 FROM boards WHERE group_id = ?", [key]))
      ctx.fail(
        "CONFLICT",
        "이 그룹에 속한 게시판이 있으므로 삭제할 수 없습니다.",
        { reason: "group_has_boards" },
      );
    const { rows } = await ctx.sql<{ member: string }>`
      SELECT member FROM _naru_member_roles WHERE role = ${`${GROUP_ROLE}${key}`}`;
    for (const { member } of rows) {
      const roles = (await ctx.rolesOf([member]))[member] ?? [];
      await ctx.setRoles(
        member,
        roles.filter((role) => role !== `${GROUP_ROLE}${key}`),
      );
    }
  }
  await ctx.sql(`DELETE FROM ${t.table} WHERE ${t.key} = ?`, [key]);
  return null;
}

/** A settings section's row key, for the owner only. */
export function settingsKeyOf(ctx: QueryCtx, section: unknown): string {
  requireOwner(ctx);
  if (typeof section !== "string" || !Object.hasOwn(SETTINGS, section))
    invalid(ctx);
  return SETTINGS[section];
}

/** A settings section's record ({ id: its form's fixed ID, data }), or null. */
export async function settingsRecord(ctx: QueryCtx, section: string) {
  const key = settingsKeyOf(ctx, section);
  const row = await one<{ value: string }>(
    ctx,
    "SELECT value FROM settings WHERE key = ?",
    [key],
  );
  return row
    ? { id: models[section].fixedId, data: parsed(row.value, {}) }
    : null;
}

/** Milliseconds at the start of a Korean day ("YYYY-MM-DD"), or null. */
export function kstStart(day: unknown): number | null {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const at = Date.parse(`${day}T00:00:00+09:00`);
  return Number.isFinite(at) ? at : null;
}

/**
 * A character's official record as its form reads it (the row's
 * experience, points, stats, titles, shown title, purchases and the day's
 * exploration), with its name and the version a save checks.
 */
export function stateOf(row: Record<string, SqlValue>) {
  const data: Record<string, any> = {
    exp: row.exp,
    stats: parsed(row.stats, {}),
    purchases: parsed(row.purchases, {}),
    owner: row.owner,
    character: String(row.id),
    approved: row.state === "approved",
    titles: parsed<string[]>(row.titles, []),
  };
  if (row.points !== null) data.points = row.points;
  if (row.active_title !== null) data.activeTitle = row.active_title;
  if (row.explore_day)
    data.explore = { day: row.explore_day, count: row.explore_count };
  return {
    id: String(row.id),
    data,
    label: row.name,
    revision: String(row.version),
  };
}

/** Characters with the titles each holds in the order given, for `stateOf`. */
export const STATE_SELECT =
  "SELECT characters.*, (SELECT json_group_array(title_id) FROM (SELECT title_id FROM character_titles WHERE character_id = characters.id ORDER BY id)) AS titles FROM characters";
