// Character sheets as members and visitors read them (member/index.php,
// ready.php, viewer.php): the lists, one sheet with the custom fields the
// reader may see, the owner's lists and fields to fill, and what a
// character's page shows beside its sheet. Visitors read them while the
// site is open (사이트공개).
import { one, signedIn } from "../../modules/access.js";
import {
  characterRow,
  characterState,
  choicesOf,
  definitionDocument,
  fieldCatalogue,
  presentCharacter,
  rankAt,
  sheetOf,
  viewable,
  visibleFields,
} from "../../modules/characters.js";
import type { CharacterRow } from "../../modules/characters.js";
import {
  coupleOf,
  outfitOf,
  outfitsOf,
  relationOf,
  relationsOf,
} from "../../modules/relations.js";
import type { CoupleRow } from "../../modules/relations.js";
import type { QueryCtx, SqlValue } from "../../modules/naru-types.js";

/** What a list may narrow to: 신청자 (editing or submitted), 승인. */
const FILTERS = {
  applicants: "state IN ('editing', 'submitted')",
  approved: "state = 'approved'",
};
/** The most a list answers at once (a statement's rows). */
const MOST = 1000;

/** The nicknames of the members owning `rows`, by member ID. */
async function nicksOf(ctx: QueryCtx, rows: CharacterRow[]) {
  const owners = [...new Set(rows.map((row) => row.owner))].slice(0, MOST);
  if (!owners.length) return {};
  const { rows: found } = await ctx.sql<{ member: string; nick: string }>(
    `SELECT member, nick FROM profiles WHERE deleted_at IS NULL AND member IN (${owners.map(() => "?").join(", ")})`,
    owners,
  );
  return Object.fromEntries(found.map((row) => [row.member, row.nick]));
}

/**
 * The owner's custom fields a reader fills or sees (the admin-only ones
 * only for the site owner) and the 소속 and 종족 lists, in their order.
 */
export async function choices(ctx: QueryCtx) {
  await viewable(ctx);
  return {
    fields: (await fieldCatalogue(ctx))
      .filter((definition) => ctx.owner || definition.visibility !== "admin")
      .map(definitionDocument),
    sides: await choicesOf(ctx, "sides"),
    classes: await choicesOf(ctx, "classes"),
  };
}

/**
 * A page of characters, `filter` "applicants", "approved" or none:
 * 멤버목록's approved ones oldest first (get_character_list's ch_id asc), the
 * rest newest first. `size` 0 answers every one (up to 1,000), as 신청자목록
 * and the list by 소속 read them; `total` counts them all. Lists carry no
 * custom values; `nicks` names their owners.
 */
export async function list(
  ctx: QueryCtx,
  args: { filter?: string | null; page?: number; size?: number } | null = {},
) {
  await viewable(ctx);
  const { filter = null, page = 1, size = 20 } = args ?? {};
  if (
    (filter !== null && !Object.hasOwn(FILTERS, filter)) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isInteger(size) ||
    size < 0 ||
    size > 100
  )
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const where = filter ? ` WHERE ${FILTERS[filter]}` : "";
  const order = filter === "approved" ? "id" : "id DESC";
  const values: SqlValue[] = size ? [size, (page - 1) * size] : [MOST, 0];
  const { rows } = await ctx.sql<CharacterRow>(
    `SELECT * FROM characters${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    values,
  );
  const total =
    (
      await one<{ n: number }>(
        ctx,
        `SELECT count(*) AS n FROM characters${where}`,
      )
    )?.n ?? 0;
  return {
    documents: rows.map((row) => sheetOf(row)),
    total,
    nicks: await nicksOf(ctx, rows),
  };
}

/** The caller's own characters, oldest first, without custom values. */
export async function mine(ctx: QueryCtx) {
  const member = signedIn(ctx);
  const { rows } = await ctx.sql<CharacterRow>`
    SELECT * FROM characters WHERE owner = ${member} ORDER BY id`;
  return { documents: rows.map((row) => sheetOf(row)) };
}

/**
 * One character with the custom values the reader may see, its owner's
 * nickname and the picture of the outfit it wears; null when there is none.
 */
export async function sheet(ctx: QueryCtx, { id }: { id?: string } = {}) {
  await viewable(ctx);
  const row = await characterRow(ctx, id);
  if (!row) return { document: null };
  const worn =
    row.outfit === null
      ? null
      : await one<{ image: string }>(
          ctx,
          "SELECT image FROM wardrobe WHERE id = ? AND character_id = ?",
          [row.outfit, row.id],
        );
  return {
    document: await presentCharacter(ctx, row),
    nicks: await nicksOf(ctx, [row]),
    outfitImage: worn?.image ?? null,
  };
}

/**
 * The first character named `name` (approved only, with `approved`), as
 * the relation, gift and money forms find the other character by its name.
 */
export async function named(
  ctx: QueryCtx,
  { name, approved = false }: { name?: string; approved?: boolean } = {},
) {
  await viewable(ctx);
  if (typeof name !== "string" || !name.trim() || name.length > 40)
    ctx.fail("INVALID_REQUEST", "입력 내용을 확인해 주세요.", {
      reason: "invalid_input",
    });
  const row = await one<CharacterRow>(
    ctx,
    `SELECT * FROM characters WHERE name = ?${approved ? " AND state = 'approved'" : ""} ORDER BY id LIMIT 1`,
    [name.trim()],
  );
  return { document: row ? sheetOf(row) : null };
}

/**
 * What a character's page shows beside its sheet, in one read: the custom
 * values the reader may see, its official record (as
 * progression:characterStatus) with its titles, its couples with their
 * partners, its relations with their targets' names, and its outfits.
 */
export async function details(
  ctx: QueryCtx,
  { character }: { character?: string } = {},
) {
  await viewable(ctx);
  const row = await characterRow(ctx, character);
  if (!row)
    ctx.fail("NOT_FOUND", "캐릭터를 확인해 주세요.", {
      reason: "no_character",
    });
  const state = await characterState(ctx, row.id);
  const { purchases, ...shown } = state.data;
  // Titles out of use (ti_use) are shown nowhere (extend/title.lib.php:7).
  const titles = (
    await ctx.sql<{
      id: string;
      name: string;
      image: string | null;
      enabled: number;
    }>`
      SELECT titles.* FROM character_titles
      JOIN titles ON titles.id = character_titles.title_id
      WHERE character_titles.character_id = ${row.id}
      ORDER BY character_titles.id`
  ).rows
    .filter((title) => title.enabled !== 0)
    .map((title) => ({
      id: title.id,
      data: { name: title.name, image: title.image },
    }));
  const couples = (
    await ctx.sql<CoupleRow>`
      SELECT * FROM couples WHERE first = ${row.id} OR second = ${row.id}
      ORDER BY sort_order, id`
  ).rows;
  const relations = await relationsOf(ctx, row.id);
  // The other characters named: couples' partners and relations' targets.
  const others = [
    ...new Set([
      ...couples.map((couple) =>
        couple.first === row.id ? couple.second : couple.first,
      ),
      ...relations.map((relation) => relation.target),
    ]),
  ];
  const names = new Map<number, string>();
  for (let at = 0; at < others.length; at += 100) {
    const ids = others.slice(at, at + 100);
    for (const other of (
      await ctx.sql<{ id: number; name: string }>(
        `SELECT id, name FROM characters WHERE id IN (${ids.map(() => "?").join(", ")})`,
        ids,
      )
    ).rows)
      names.set(other.id, other.name);
  }
  const partner = (id: number) =>
    names.has(id) ? { id: String(id), name: names.get(id) } : null;
  return {
    fields: visibleFields(ctx, row, await fieldCatalogue(ctx)),
    status: {
      state: shown,
      revision: state.revision,
      definitions: state.definitions,
      rank: await rankAt(ctx, state.data.exp),
    },
    titles,
    couples: couples.map((couple) => ({
      ...coupleOf(couple),
      partner: partner(couple.first === row.id ? couple.second : couple.first),
    })),
    relations: relations.map((relation) => ({
      ...relationOf(relation),
      target: partner(relation.target),
    })),
    wardrobe: (await outfitsOf(ctx, row.id)).map(outfitOf),
  };
}
