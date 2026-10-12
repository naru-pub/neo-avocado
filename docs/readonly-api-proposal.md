# Approved SDK addition: read-only site functions

Application admission and bans cannot protect native member collection access.
The application now uses administrator-only collections and site functions
that check its member records before returning data. This is necessary to
enforce the community's rules on the server.

Naru currently charges every function invocation against 30 calls per member
per fixed minute (`edge/src/site.ts:240–261, 744`). That includes reads and
unread polling. The existing browser fixture does not enforce that limit; it
now records its peak to avoid treating a synthetic pass as production proof.
The migrated workflow requires more calls than the demo's original native
collection reads. Raising the write/function budget for everything would
also raise the allowed volume of economic mutations.

## Approved and implemented locally (2026-10-12)

- `member.read("module/function", args, { signal? })` invokes the site's
  trusted function with the same member identity, origin checks and JSON
  result contract as `call`.
- The server enforces a read-only host: `ctx.add`, `ctx.set` and `ctx.delete`
  fail the entire invocation, even if the function catches the failure.
  A function must not be able to write by choosing this endpoint.
- Reads retain the CPU, memory, operation, result-size and monthly request
  limits. They use a separate bounded read rate (120/minute), so
  they cannot consume or bypass the 30/minute mutation budget.
- `member.call` and frozen 1.0.0 bytes remain unchanged. Mutable 1.1.0 types,
  assets, reference and server routing have been updated.
- The port uses `read` for community get/list, membership/status, mailbox
  lists and history. Sends, receipts, deletion, purchases and content writes
  keep using `call`.
- Verify read-only enforcement, caught errors, atomicity, authentication,
  monthly accounting, independent rate budgets, abort behavior and stale
  assets. Then rerun browser tests with production limits enforced.

The user approved read-only SDK functions. Media deletion remains a separate,
unapproved proposal and has not been implemented.

Local verification: 14 SDK member tests, 58 edge tests, 41 app tests and the
QuickJS/SQLite app checks pass. Chrome with the actual SDK enforces both
budgets and passed at a peak of 84 reads/120 and 10 mutations/30 per minute.
Real local HTTP/DO SDK and membership suites pass (27 checks, one existing
skip), including authentication, forbidden writes and independent 120/30
server rate limits.
The SDK contract also passes all 11 checks through the public Worker route.
These results do not establish production deployment acceptance.
