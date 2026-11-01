// The shapes Naru hands queries and mutations (SDK 1.1.0), for type checking
// only: this module exports types and compiles to nothing. They are Naru's
// own declarations, from the @naru-pub/sdk package.
export type {
  CallingMember,
  MutationCtx,
  QueryCtx,
  SqlResult,
  SqlValue,
} from "@naru-pub/sdk/functions";

/** A guest's name and password, proving a post or comment is theirs. */
export interface GuestCredentials {
  name?: string;
  password?: string;
}
