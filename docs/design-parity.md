# 디자인 사용 parity audit

The enabled theme keeps the original AvocadoEdition layout. The public spacing
redesign applies only with 디자인 사용 off. This is a source comparison, not a
pixel-by-pixel certification of a running PHP installation.

## Reference

Compared against the sibling AvocadoEdition checkout:

- `AvocadoEdition/install/install_db.php`: installed `css_config` defaults.
- `AvocadoEdition/adm/design_form_css.php`: generated design rules and targets.
- `AvocadoEdition/css/style.css`: controls, header and responsive layout.
- `AvocadoEdition/head.php`: logo, menu and content structure.

The generated, untracked `css/_design.config.css` was not used as the source of
truth: its values depend on an installation's database and may be blank.

## Confirmed behavior

| Setting / part       | Original                                                                         | neo-avocado                                     |
| -------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| Default menu         | Left, 200px                                                                      | Left, 200px                                     |
| Top menu             | Explicit option; saved height, default 50px                                      | Explicit option; saved height, default 50px     |
| Header disabled      | Hide header/footer and remove sidebar offset                                     | Hide header/copyright and remove sidebar offset |
| Mobile header/menu   | At 1024px and below, fixed 50px header and 280px right drawer                    | Same breakpoint and dimensions                  |
| Body type            | 12px, line height 1.5em                                                          | Same                                            |
| Installed palette    | White text, #333 background, #29c7c9 accent                                      | Same                                            |
| Inputs               | Black background, #eee text, #222 border                                         | Same                                            |
| Comments             | Translucent black, #eaeaea text; author 12px, date 11px                          | Same principal defaults                         |
| Original-post author | Cyan, wrapped in ▶ and ◀                                                         | Same; editable prefix/suffix                    |
| Submenu              | Separate submenu with configurable box, colors and hover                         | `.tabs`, separate from the site menu            |
| Design controls      | Backgrounds; button states; table/form/log parts; input/box corners; text styles | Existing checked CSS mappings retained          |

The enabled theme stylesheet and design-setting mappings were restored to the
pre-shared-layout implementation (`667c7e2`). Neither the off-mode form spacing
nor the new top-layout default applies to the enabled theme.

## Known pre-existing differences

These prevent a claim of exact parity. This restoration does not change them.

- **Mobile page background:** the original changes `m_background` at 1024px;
  the port switches at 700px, including the generated mobile-background rules.
  The original removes the desktop image if no mobile image is configured; the
  port falls back to the desktop image/pattern.
- **Pattern asset:** the original uses its installed PNG; the port reproduces
  the pattern with CSS gradients.
- **Secondary button default:** the original installs a #555 background and
  #333 border for `btn_etc`; the port's template falls back to its generic black
  button unless that style is configured. Saved secondary-button colors still
  have a dedicated mapping.
- **Structure and navigation:** this is a TypeScript/Naru port, with its own DOM
  and community navigation. PHP selectors and arbitrary original-theme CSS
  cannot be assumed to work unchanged. The default title also substitutes for
  the original installation's logo when none is configured.

Saved values, generated CSS, and precedence are covered by the existing design
and page tests. They do not prove every visual combination or exact PHP-page
geometry. The admin layout and forms are unchanged by this restoration.
