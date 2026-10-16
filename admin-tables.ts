// For the time being: the owner's SDK handle with the site's tables standing
// in for the collections they replaced (the foundation's, the characters'
// and the economy's: modules/documents.js), through the owner-only
// admin/documents query and mutation. The admin page keeps reading and
// writing documents until the admin area is ported to mutations of its
// own; then this goes.
import { mappingOf } from "./_naru/modules/documents.js";

const notFound = (id) =>
  Object.assign(new Error(`No document ${id}.`), { code: "NOT_FOUND" });

/** A list's `where`, as far as the admin asks one: equality on a field. */
function whereFilter(where) {
  if (!where) return {};
  if (Array.isArray(where.eq) && typeof where.eq[0] === "string")
    return { [where.eq[0]]: where.eq[1] };
  throw new Error("A table's list takes equality on a field only.");
}

/** A collection-like view of one of the foundation's tables. */
function table(owner, collection: string) {
  const list = ({
    size = 50,
    after = null,
    filter = {},
    where = null,
  }: {
    size?: number;
    after?: string | null;
    filter?: Record<string, unknown>;
    where?: any;
  } = {}) =>
    owner.query("admin/documents:list", {
      collection,
      size: Math.min(size, 100),
      after,
      filter: { ...filter, ...whereFilter(where) },
    });
  return {
    async get(id: string) {
      const found = await owner.query("admin/documents:get", {
        collection,
        id,
      });
      if (!found) throw notFound(id);
      return found;
    },
    list,
    async *pages(options = {}) {
      let after = null;
      do {
        const page = await list({ ...options, after });
        yield page;
        after = page.nextCursor;
      } while (after);
    },
    set: (id: string, data: unknown, { condition = undefined } = {}) =>
      owner.mutate("admin/documents:set", { collection, id, data, condition }),
    delete: (id: string) =>
      owner.mutate("admin/documents:remove", { collection, id }),
  };
}

/** What a batch's write answers, as the SDK's batch does. */
const written = (document) =>
  document
    ? {
        id: document.id,
        revision: document.revision,
        createdAt: null,
        updatedAt: null,
      }
    : null;

/**
 * The owner's handle, its collection() and batch() reaching the tables for
 * the collections they replaced. A batch writes the collections in one
 * transaction and the tables in another, after it.
 */
export function withTables(owner) {
  return {
    ...owner,
    collection: (name: string) =>
      mappingOf(name) ? table(owner, name) : owner.collection(name),
    async batch(operations: any[]) {
      const documents = operations.filter((op) => !mappingOf(op.collection));
      const tables = operations.filter((op) => mappingOf(op.collection));
      const first = documents.length ? await owner.batch(documents) : [];
      const second = tables.length
        ? (
            await owner.mutate("admin/documents:batch", {
              writes: tables.map((op) =>
                op.set
                  ? { collection: op.collection, set: op.set }
                  : { collection: op.collection, delete: { id: op.delete.id } },
              ),
            })
          ).map(written)
        : [];
      return operations.map((op) =>
        mappingOf(op.collection) ? second.shift() : first.shift(),
      );
    },
  };
}
