# Server functions

`functions/` contains callable entry points grouped by community, economy,
characters and content. `modules/shared.js` contains shared validation,
authorization and transaction helpers; `modules/characters.js` holds character
sheets (custom fields, visibility, application state) and `modules/roleplay.js`
posting as a character, dice, exploration, in-post items and calls. These are ordinary JavaScript modules:
Naru SDK 1.1.0 loads their static relative imports directly. No generated runtime
files or bundling step is needed.

`function-references.js` at the site root maps frontend calls to
`<module/path>:<export>`. Shared modules cannot be called directly. The
`modules/index.js` barrel is for Node tests; production calls load only their
entry point and its dependencies.

Deploy the entire site together through GitHub or a template install. If editing
individual files, save shared dependencies first. Naru validates and activates a
revision after file changes; an invalid import leaves the prior revision running.
This requires the Naru Worker and control plane with native import support.

`rules/community-board.js` is a collection rule, not a callable function. It
imports `modules/shared.js` for member access, boards and secret visibility, so
the rule and the `communityData` gate share one implementation. Naru publishes
rules with the function revision. Functions and shared modules cannot import a
rule.
