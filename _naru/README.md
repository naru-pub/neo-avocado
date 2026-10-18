# Queries and mutations

`queries/` holds the site's read-only entry points and `mutations/` the
writing ones, grouped by community, economy, characters, content and admin;
`modules/` holds what they share (`access.js`: who may do what and the
owner's settings; `boards.js`, `characters.js`, `economy.js`, `mail.js`,
`members.js`: each area's rows; `admin.js` and `admin-model.js`: the
owner's admin). They are ordinary JavaScript modules that
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
(`0001`), the boards (`0002`), characters (`0003`), the economy (`0004`),
mail (`0005`) and search (`0006`), then columns added since (`0007`–`0024`:
board admins, post links, member blocks, recommenders, item details, stat
order, secret comments, reply posts, post hits, attachments, shop entries, comment replies, link hits, birth years, owner options,
chick and votes, popups and polls, field sizes). There are no collections, rules or site functions. Nothing is
pushed to pages: they subscribe to `community/inbox:status` (unread 쪽지 and
calls) and `community/posts:latest`, and Naru answers again when a mutation
writes a table those read.

`admin/` is the owner's: one module per section of the admin page
(`admin/boards`, `admin/members`, `admin/items`, …) with `list`, `get`,
`save` and `remove` where the section has them, each refusing anyone but
the owner. A save takes the form's values and checks them with the
section's model (`modules/admin-model.js`, which the page draws its forms
from), so the forms' rules hold whoever calls; values left out keep the
record's own. Changes that go together are one mutation: a balance and its
history entry, a character's record (at its version) and its experience
history, a title given to or taken from many characters. The reports
(`admin/visits:report`, `admin/activity:report`), the character review and
회원 관리 are queries that search, filter and count in SQL.

`routes/` serves the pages' addresses (`/logs/free/12`, `/character/3`, …):
each file answers the path it is named for (`_id` is a parameter,
`_...rest` the rest of the path, `index` the directory) with index.html and
that page's link preview (`modules/previews.js`), read as a visitor reads it.
What an address names is `modules/places.js`, which the page reads too.

Deploy the entire site together through GitHub or a template install. If
editing individual files, save shared dependencies first. Naru validates and
activates a revision after file changes; an invalid import leaves the prior
revision running.
