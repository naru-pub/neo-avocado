// The shapes Naru hands site functions and collection rules (SDK 1.1.0), for
// type checking only: this module exports types and compiles to nothing.

/** A document's data: its shape varies by collection. */
export type Data = Record<string, any>;

/** A stored document, as `get`, `add`, `set` and `list` return it. */
export interface NaruDocument<T = Data> {
  id: string;
  data: T;
  revision?: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** The member who created it natively, or null. */
  createdBy?: string | null;
}

/** One page of a list. */
export interface Page<T = Data> {
  documents: NaruDocument<T>[];
  nextCursor: string | null;
  totalCount?: number;
}

/** A top-level data field, or a document's metadata. */
export type Field =
  string | { metadata: "id" | "createdBy" | "createdAt" | "updatedAt" };

export type Scalar = string | number | boolean | null;

/** The predicate language of `where` and of a rule's `readable`. */
export type Where =
  | boolean
  | { all: Where[] }
  | { any: Where[] }
  | { eq: [Field, Scalar] }
  | { ne: [Field, Scalar] }
  | { gt: [Field, Scalar] }
  | { gte: [Field, Scalar] }
  | { lt: [Field, Scalar] }
  | { lte: [Field, Scalar] }
  | { in: [Field, Scalar[]] }
  | { contains: [Field, string] }
  | { has: [Field, Scalar] };

export type SortKey = [Field, "asc" | "desc"];

/** Scalar equality on top-level fields, ANDed. */
export type Filter = Record<string, unknown>;

export interface ListOptions {
  filter?: Filter;
  where?: Where;
  sort?: SortKey[];
  /** 1–100; 50 when left out. */
  size?: number;
  after?: string | null;
  includeTotal?: boolean;
}

export interface CountOptions {
  filter?: Filter;
  where?: Where;
}

export interface WriteOptions {
  /** Writes only if the document is still at this revision. */
  condition?: { revision?: string | null };
}

export interface AddOptions {
  /** A document secret (a guest's password), checked by `secretMatches`. */
  secret?: string;
}

export interface Member {
  id: string;
}

/** What collection rules may use of the context: reads only. */
export interface ReadCtx {
  /** The signed-in member, or null for a visitor. */
  member: Member | null;
  /** Whether the caller is the site owner. */
  owner?: boolean;
  /** Whether the caller is a visitor: neither a member nor the owner. */
  visitor?: boolean;
  get<T = Data>(
    collection: string,
    id: string,
  ): Promise<NaruDocument<T> | null>;
  getMany<T = Data>(
    collection: string,
    ids: string[],
  ): Promise<(NaruDocument<T> | null)[]>;
  list<T = Data>(collection: string, options?: ListOptions): Promise<Page<T>>;
  count(collection: string, options?: CountOptions): Promise<number>;
}

/** The context a site function receives. */
export interface Ctx extends ReadCtx {
  /** The call's time, in milliseconds. */
  now: number;
  add<T = Data>(
    collection: string,
    data: T,
    options?: AddOptions,
  ): Promise<NaruDocument<T>>;
  set<T = Data>(
    collection: string,
    id: string,
    data: T,
    options?: WriteOptions,
  ): Promise<NaruDocument<T>>;
  delete(collection: string, id: string): Promise<unknown>;
  /** Refuses the call: its writes roll back and the page shows `message`. */
  fail(code: string, message: string, details?: Record<string, unknown>): never;
  /** Sends `data` to a member's open pages after the call commits. */
  notify(member: string, data: unknown): void;
  /** Sends `data` to every page listening on `topic` after the call commits. */
  broadcast(topic: string, data: unknown): void;
  /** Whether `secret` is the document's secret (`AddOptions.secret`). */
  secretMatches(
    collection: string,
    id: string,
    secret: string,
  ): Promise<boolean>;
}

/** A rule's `readable(ctx, args)`. */
export interface ReadArgs {
  collection: string;
  operation: "get" | "list" | "getMany";
  id?: string | null;
  /** A batch read's IDs, without repeats (getMany only). */
  ids?: string[];
  filter?: Filter;
  /** The caller's own predicate, or null. */
  where?: Where | null;
}

/** A rule's `present(ctx, args)`: one document as the reader sees it. */
export interface PresentArgs {
  collection?: string;
  document: NaruDocument;
}

/** A rule's `canWrite(ctx, args)`. */
export interface WriteArgs {
  collection: string;
  operation: "create" | "update" | "delete";
  before: NaruDocument | null;
  after: NaruDocument | null;
}

/** A guest's name and password, proving a post or comment is theirs. */
export interface GuestCredentials {
  name?: string;
  password?: string;
}
