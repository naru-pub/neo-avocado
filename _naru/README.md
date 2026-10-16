# Server functions

`functions/` contains callable entry points grouped by community, economy,
characters and content. `modules/shared.js` contains shared validation,
authorization and transaction helpers; `modules/characters.js` holds character
sheets (custom fields, visibility, application state) and `modules/roleplay.js`
posting as a character, dice, exploration, in-post items and calls. These are ordinary JavaScript modules:
Naru SDK 1.1.0 loads their static relative imports directly. No generated runtime
files or bundling step is needed.

Pages call a function by `"<module/path>:<export>"`, as the SDK takes it:
`member.call("community/messages:sendMessage", { recipients, body })`, and
queries and mutations likewise: `member.mutate("community/posts:write", { data })`. A function that refuses calls
`ctx.fail(code, "한국어 메시지", { reason })`; its writes roll back and the page
shows the message. `tests/function-modules.test.mjs` checks that every reference
names an export and every export is called. Shared modules cannot be called
directly. The `modules/index.js` barrel is for Node tests; production calls load
only their entry point and its dependencies.

Deploy the entire site together through GitHub or a template install. If editing
individual files, save shared dependencies first. Naru validates and activates a
revision after file changes; an invalid import leaves the prior revision running.
This requires the Naru Worker and control plane with native import support.

Profiles, settings, members, wallets and the site's frame are tables now
(`migrations/0001_foundation.sql`), and so are the boards with their posts,
comments, tags, calls and emoticons (`migrations/0002_boards.sql`),
characters with their fields, lists, titles, relations, outfits, couples,
stats and ranks (`migrations/0003_characters.sql`), and the economy's items,
inventory, recipes and draw tables (`migrations/0004_economy.sql`), read
through `queries/` and written through `mutations/`, which decide who may do
what (`modules/access.js`, `modules/boards.js`). The old site functions left
(mail) read them with `ctx.sql` through the same modules.
`functions/economy/notices.js` only sends the 쪽지 a gift or money sent
tells its recipient of, while mail is still a collection.
