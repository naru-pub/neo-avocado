# Queries and mutations

`queries/` holds the site's read-only entry points and `mutations/` the
writing ones, grouped by community, economy, characters, content and admin;
`modules/` holds what they share (`access.js`: who may do what and the
owner's settings; `boards.js`, `characters.js`, `economy.js`, `mail.js`,
`members.js`: each area's rows). They are ordinary JavaScript modules that
Naru SDK 1.1.0 loads by their static relative imports; nothing is bundled.

Pages call them by `"<module/path>:<export>"`:
`query("community/messages:conversations", { page })`,
`mutate("community/messages:sendMessage", { recipients, body })`, and keep
an answer current with `subscribe(...)`. One that refuses calls
`ctx.fail(code, "한국어 메시지", { reason })`; its writes roll back and the
page shows the message. `tests/function-modules.test.mjs` checks that every
reference names an export and every export is called. Shared modules cannot
be called directly.

The data is the site's own tables, which `migrations/` make: the foundation
(`0001`), the boards (`0002`), characters (`0003`), the economy (`0004`) and
mail (`0005`). There are no collections, rules or site functions. Nothing is
pushed to pages: they subscribe to `community/inbox:status` (unread 쪽지 and
calls) and `community/posts:latest`, and Naru answers again when a mutation
writes a table those read.

Deploy the entire site together through GitHub or a template install. If
editing individual files, save shared dependencies first. Naru validates and
activates a revision after file changes; an invalid import leaves the prior
revision running.
