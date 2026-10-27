// What a failed call carries, for the pages' messages: Naru's code, and a
// query's or mutation's ctx.fail details.

import type { Data as Details } from "../_naru/modules/json.js";

export interface CallError {
  code?: string;
  message?: string;
  details?: { unique?: string; reason?: string; membership?: string } & Details;
}

/** A thrown value, as the call error it usually is. */
export const callError = (error: unknown): CallError | undefined =>
  typeof error === "object" && error !== null
    ? (error as CallError)
    : undefined;
