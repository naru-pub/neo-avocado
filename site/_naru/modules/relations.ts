// What hangs off a character: its relations (relation_list.php), its outfits
// (closet.php) and the couples the owner registers (couple/), as pages read
// them ({ id, data }).
import type { SqlCtx } from "./access.js";

export interface RelationRow {
  id: number;
  owner: string;
  character_id: number;
  target: number;
  affinity: number;
  memo: string;
  link: string;
  sort_order: number;
  created_at: number;
  version: number;
}

export const relationOf = (row: RelationRow) => ({
  id: String(row.id),
  data: {
    owner: row.owner,
    character: String(row.character_id),
    target: String(row.target),
    affinity: row.affinity,
    memo: row.memo,
    link: row.link,
    order: row.sort_order,
  },
  revision: String(row.version),
  createdAt: new Date(row.created_at).toISOString(),
});

export interface OutfitRow {
  id: number;
  owner: string;
  character_id: number;
  name: string;
  image: string;
}

export const outfitOf = (row: OutfitRow) => ({
  id: String(row.id),
  data: {
    owner: row.owner,
    character: String(row.character_id),
    name: row.name,
    image: row.image,
  },
});

export interface CoupleRow {
  id: string;
  first: number;
  second: number;
  since: string | null;
  sort_order: number;
}

export const coupleOf = (row: CoupleRow) => ({
  id: row.id,
  data: {
    first: String(row.first),
    second: String(row.second),
    since: row.since,
    order: row.sort_order,
  },
});

/** A character's relations, rm_order then the newest first (relation_list.php:4). */
export async function relationsOf(ctx: SqlCtx, character: number) {
  return (
    await ctx.sql<RelationRow>`
      SELECT * FROM relations WHERE character_id = ${character}
      ORDER BY sort_order, id DESC`
  ).rows;
}

/** A character's outfits, oldest first. */
export async function outfitsOf(ctx: SqlCtx, character: number) {
  return (
    await ctx.sql<OutfitRow>`SELECT * FROM wardrobe WHERE character_id = ${character} ORDER BY id`
  ).rows;
}
