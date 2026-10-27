// What the pages send to and read from the site's queries and mutations.

import type { Data } from "../_naru/modules/json.js";

/**
 * A row's fields, as the site's queries answer them: the site's own JSON,
 * whose shape each query's module (_naru/) decides.
 */
export type Fields = Data;
/** A document a site query answers with: its id, its fields, and who wrote it. */
export interface Row<T = Fields> {
  id: string;
  data: T;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  revision?: string;
}
/** A page of rows, and where the next begins. */
export interface RowPage<T = Fields> {
  documents: Row<T>[];
  nextCursor: string | null;
}
/**
 * A call's arguments: what the page passes, sent as JSON (fields left
 * `undefined` are dropped on the way).
 */
export type Args = Record<string, unknown> | null;
