// The shapes Naru hands queries and mutations (SDK 1.1.0), for type checking
// only: this module exports types and compiles to nothing. They are Naru's
// own declarations (types/naru-functions.d.ts, a copy of
// https://sdk.naru.pub/sdk/1.1.0/functions.d.ts).
export type {
  CallingMember,
  MutationCtx,
  QueryCtx,
  SqlResult,
  SqlValue,
} from "../../../types/naru-functions";

/** A guest's name and password, proving a post or comment is theirs. */
export interface GuestCredentials {
  name?: string;
  password?: string;
}
