# Server functions

`functions/` contains callable entry points grouped by community, economy,
characters and content. `modules/shared.js` contains shared validation,
authorization and transaction helpers; `modules/characters.js` holds character
sheets (custom fields, visibility, application state) and `modules/roleplay.js`
posting as a character, dice, exploration, in-post items and calls. These are ordinary JavaScript modules:
Naru SDK 1.1.0 loads their static relative imports directly. No generated runtime
files or bundling step is needed.

Pages call a function by `"<module/path>:<export>"`, as the SDK takes it:
`member.call("economy/shop:buy", { item })`. A function that refuses calls
`ctx.fail(code, "한국어 메시지", { reason })`; its writes roll back and the page
shows the message. `tests/function-modules.test.mjs` checks that every reference
names an export and every export is called. Shared modules cannot be called
directly. The `modules/index.js` barrel is for Node tests; production calls load
only their entry point and its dependencies.

Deploy the entire site together through GitHub or a template install. If editing
individual files, save shared dependencies first. Naru validates and activates a
revision after file changes; an invalid import leaves the prior revision running.
This requires the Naru Worker and control plane with native import support.

`rules/` holds collection rules, not callable functions: what members and
visitors may read of each collection, and how much of each document. Pages
read natively through them; `_naru/collections.json` names the rule of each
collection.

- `community-board.js`: posts and comments, by board level and secret posts.
- `characters.js`: characters, with only the custom fields the reader may see.
- `boards.js`: the boards the reader's level may list.
- `profiles.js`: nicknames for everyone, whole profiles for members.
- `own.js`: a member's own wallet and inventory.
- `settings.js`, `character-fields.js`, `shown.js`: community settings, field
  definitions without admin-only ones, and catalogues without deleted rows.

Rules import `modules/shared.js` for member access, boards and secret
visibility, so they and the `communityData` function, through which every
community write goes, share one implementation. Naru publishes rules with the
function revision. Functions and shared modules cannot import a rule.
