// What a member's or visitor's native read returns on Naru, for the in-memory
// fakes: the declaration's read access first, then the collection's rule
// (readable narrows the rows, present trims each), as _naru/collections.json
// configures them. Owners and site functions read everything; pages do not.
import { readFile } from "node:fs/promises";
import { matches } from "./where.mjs";

const { collections } = JSON.parse(
  await readFile(new URL("../_naru/collections.json", import.meta.url), "utf8"),
);
// A rule module may keep state for the call (characters.js reads the field
// definitions once a page): load it afresh for each read, as Naru runs it.
let loads = 0;
const ruleOf = (name) =>
  import(
    new URL(`../_naru/rules/${name}.js?read=${loads++}`, import.meta.url).href
  );
const denied = (code, message) => Object.assign(new Error(message), { code });

/**
 * `{ collection, operation: "get" | "getMany" | "list", id, options }`, read
 * as ctx.member (null for a visitor) would read it through the SDK.
 */
export async function nativeRead(
  ctx,
  { collection, operation, id, options = {} },
) {
  const declared = collections[collection];
  if (!declared) throw denied("NOT_FOUND", `No collection ${collection}.`);
  if (declared.read === "admin" || (declared.read === "member" && !ctx.member))
    throw denied("ACCESS_DENIED", `${collection} is not readable here.`);
  const rule = declared.rules ? await ruleOf(declared.rules) : null;
  const filter = { ...options.filter };
  const where = options.where ?? null;
  const scope = rule
    ? await rule.readable(ctx, {
        collection,
        operation: operation === "get" ? "get" : "list",
        id: id ?? null,
        filter,
        where,
      })
    : true;
  const all = [];
  let after = null;
  do {
    const page = await ctx.list(collection, { size: 100, after });
    all.push(...page.documents);
    after = page.nextCursor;
  } while (after);
  const visible = (row) =>
    row && matches(row, scope === true ? undefined : scope);
  const shown = async (row) =>
    rule?.present
      ? { ...row, data: await rule.present(ctx, { collection, document: row }) }
      : row;
  if (operation === "get") {
    const row = all.find((candidate) => candidate.id === id);
    if (!visible(row)) throw denied("NOT_FOUND", "Document not found.");
    return { document: await shown(row) };
  }
  if (operation === "getMany")
    return {
      documents: await Promise.all(
        options.ids.map(async (wanted) => {
          const row = all.find((candidate) => candidate.id === wanted);
          return visible(row) ? shown(row) : null;
        }),
      ),
    };
  const rows = all.filter(
    (row) =>
      visible(row) &&
      Object.entries(filter).every(
        ([field, value]) => row.data[field] === value,
      ) &&
      matches(row, where ?? undefined),
  );
  return { documents: await Promise.all(rows.map(shown)), nextCursor: null };
}
