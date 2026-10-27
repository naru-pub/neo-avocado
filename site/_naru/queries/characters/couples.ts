// 커플목록 (couple/): every couple the owner registered, with both
// characters' pictures and names.
import { viewable } from "../../modules/characters.js";
import type { QueryCtx } from "../../modules/naru-types.js";
import type { CoupleRow } from "../../modules/relations.js";
import { coupleOf } from "../../modules/relations.js";

export async function list(ctx: QueryCtx) {
  await viewable(ctx);
  const { rows } = await ctx.sql<
    CoupleRow & {
      first_name: string | null;
      first_image: string | null;
      second_name: string | null;
      second_image: string | null;
    }
  >`
    SELECT couples.*, a.name AS first_name, a.image AS first_image,
      b.name AS second_name, b.image AS second_image
    FROM couples
    LEFT JOIN characters AS a ON a.id = couples.first
    LEFT JOIN characters AS b ON b.id = couples.second
    ORDER BY couples.sort_order, couples.id
    LIMIT 1000`;
  const side = (id: number, name: string | null, image: string | null) =>
    name === null ? null : { id: String(id), data: { name, image } };
  return {
    couples: rows.map((row) => ({
      ...coupleOf(row),
      first: side(row.first, row.first_name, row.first_image),
      second: side(row.second, row.second_name, row.second_image),
    })),
  };
}
