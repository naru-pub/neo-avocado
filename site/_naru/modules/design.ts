// 디자인 설정's styles (adm/design_form.php, design_form_css.php): the owner's
// backgrounds, menu layout, buttons, tables, the mmb log board's parts,
// inputs, boxes, the sub menu and the equalizer, kept in the design settings
// row, checked here value by value and made into the page's design CSS.
// Every value that reaches the CSS is one of a few shapes (a colour, a whole
// number of pixels, a choice from a list, an HTTPS address), so nothing the
// owner writes can end a rule or add one. The page sets the text as a
// <style> element's textContent; it applies with 디자인 사용 on.

import { imageUrl } from "./access.js";

/** A colour the original's text fields take: #rgb…#rrggbbaa, rgb(), rgba(), transparent. */
const COLOR =
  /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(?:,\s*(?:0|1|0?\.\d{1,4}|\d{1,3}%)\s*)?\)|transparent)$/i;
// An HTTPS address with nothing CSS reads as syntax: no quotes, brackets,
// backslashes, semicolons or braces, so url("…") holds it as it is.
const HTTPS =
  /^https:\/\/[^\s/@?#:"'()\\;{}<>]+(?::\d{1,5})?(?:[/?#][^\s"'()\\;{}<>]*)?$/;

export const colorOf = (value: unknown): string | null =>
  typeof value === "string" && value.length <= 40 && COLOR.test(value.trim())
    ? value.trim()
    : null;
const httpsOf = (value: unknown): string | null =>
  typeof value === "string" && value.length <= 2000 && HTTPS.test(value)
    ? value
    : null;
/** A whole number of pixels, 0 to `max`, or null. */
function pixels(value: unknown, max = 2000): number | null {
  const number =
    typeof value === "string" && value !== "" ? Number(value) : value;
  return Number.isSafeInteger(number) &&
    (number as number) >= 0 &&
    (number as number) <= max
    ? (number as number)
    : null;
}
const choice = (value: unknown, choices: readonly string[]): string | null =>
  typeof value === "string" && value && choices.includes(value) ? value : null;

/** design_form.php's choices, the first of each its blank (CSS's own). */
export const REPEATS = ["no-repeat", "repeat-x", "repeat-y"] as const;
export const POSITIONS = [
  "left top",
  "left center",
  "left bottom",
  "center top",
  "center center",
  "center bottom",
  "right top",
  "right center",
  "right bottom",
] as const;
export const SIZES = ["contain", "cover", "100% 100%"] as const;
export const BORDER_STYLES = ["solid", "dotted", "dashed", "double"] as const;
export const SIDES = ["top", "bottom", "left", "right"] as const;

/** A background group: 이미지, 색상코드, 배경반복, 배경위치, 배경크기, 고정. */
export const BACKGROUNDS = {
  // m_background's own color and placing (its picture is mobileBackground).
  mobileBackground: { label: "모바일 배경", image: false, fixed: false },
  header: { label: "헤더배경", image: false, fixed: true },
  mobileHeader: { label: "모바일 헤더배경", image: true, fixed: true },
  menu: { label: "메뉴배경", image: true, fixed: true },
  mobileMenu: { label: "모바일 메뉴배경", image: true, fixed: true },
  board: { label: "로드비 전체 배경", image: true, fixed: true },
} as const;
/** A box group: 배경색상, 폰트색상, 라인색상·타입·굵기·방향 (and its extra). */
export const BOXES = {
  table: { label: "전체테이블" },
  listHeader: { label: "목록 : 제목" },
  listBody: { label: "목록 : 내용" },
  formHeader: { label: "양식 : 제목" },
  formBody: { label: "양식 : 내용" },
  notice: { label: "공지사항" },
  logList: { label: "리스트영역" },
  // mmb_list_item: each log, its picture and comments (#log_list .item).
  logItem: { label: "로그 (이미지 + 코멘트)", margin: true },
  logImage: { label: "이미지" },
  comments: { label: "코멘트" },
  comment: { label: "개별코멘트", margin: true },
  subMenu: { label: "서브메뉴", hover: true },
} as const;
/** btn_default, btn_point, btn_etc: 텍스트·배경·라인색상, and on hover. */
export const BUTTONS = {
  button: "기본버튼",
  pointButton: "포인트버튼",
  etcButton: "기타버튼",
} as const;
/** input_bak and box_style: 배경·폰트·라인색상 and the four corners. */
export const PANELS = { input: "입력폼", box: "기본박스" } as const;
/** The mmb skin's text parts: 색상 (and 폰트크기). */
export const TEXTS = {
  author: { label: "「작성자」", size: true },
  // mmb_owner_name: the log's own writer commenting (p.owner).
  ownerName: { label: "「작성자」 원글 작성자", size: true },
  date: { label: "「날짜」", size: true },
  link: { label: "「외부링크」", size: false },
  call: { label: "「멤버호출」", size: false },
  logLink: { label: "「로그링크」", size: false },
  hashTag: { label: "「해시태그」", size: false },
} as const;
const CORNERS = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;

/**
 * mmb_owner_name's 접두문자 and 접미문자 (cs_etc_2, cs_etc_3), text the page
 * puts around the log writer's name on their own comments, design or not
 * (list.skin.php:20-23 reads them either way). The original installs ▶ and ◀.
 */
export function ownerMarks(saved: Record<string, any> = {}) {
  const owner = saved?.styles?.ownerName ?? {};
  const mark = (value: unknown, installed: string) =>
    typeof value === "string" ? value.trim().slice(0, 20) : installed;
  return { prefix: mark(owner.prefix, "▶"), suffix: mark(owner.suffix, "◀") };
}

/** What a design's styles are, every value checked; what is not set is left out. */
export function designStyles(saved: Record<string, any> = {}) {
  const given =
    saved?.styles && typeof saved.styles === "object" ? saved.styles : {};
  const group = (key: string) =>
    given[key] && typeof given[key] === "object" ? given[key] : {};
  const styles: Record<string, Record<string, any>> = {};
  const keep = (key: string, value: Record<string, any>) => {
    const set = Object.fromEntries(
      Object.entries(value).filter(
        ([, entry]) =>
          entry !== null && !(Array.isArray(entry) && !entry.length),
      ),
    );
    if (Object.keys(set).length) styles[key] = set;
  };
  for (const [key, { image, fixed }] of Object.entries(BACKGROUNDS)) {
    const g = group(key);
    keep(key, {
      image: image ? httpsOf(g.image) : null,
      color: colorOf(g.color),
      repeat: choice(g.repeat, REPEATS),
      position: choice(g.position, POSITIONS),
      size: choice(g.size, SIZES),
      fixed: fixed && g.fixed === "fixed" ? "fixed" : null,
    });
  }
  for (const [key, box] of Object.entries(BOXES)) {
    const g = group(key);
    keep(key, {
      background: colorOf(g.background),
      color: colorOf(g.color),
      hover: "hover" in box ? colorOf(g.hover) : null,
      margin: "margin" in box ? pixels(g.margin, 200) : null,
      borderColor: colorOf(g.borderColor),
      borderStyle: choice(g.borderStyle, BORDER_STYLES),
      borderWidth: pixels(g.borderWidth, 50),
      borderSides: Array.isArray(g.borderSides)
        ? SIDES.filter((side) => g.borderSides.includes(side))
        : [],
    });
  }
  for (const key of Object.keys(BUTTONS)) {
    const g = group(key);
    keep(key, {
      color: colorOf(g.color),
      background: colorOf(g.background),
      borderColor: colorOf(g.borderColor),
      hoverColor: colorOf(g.hoverColor),
      hoverBackground: colorOf(g.hoverBackground),
      hoverBorderColor: colorOf(g.hoverBorderColor),
    });
  }
  for (const key of Object.keys(PANELS)) {
    const g = group(key);
    keep(key, {
      background: colorOf(g.background),
      color: colorOf(g.color),
      borderColor: colorOf(g.borderColor),
      ...Object.fromEntries(
        CORNERS.map((corner) => [corner, pixels(g[corner], 200)]),
      ),
    });
  }
  for (const [key, { size }] of Object.entries(TEXTS)) {
    const g = group(key);
    keep(key, {
      color: colorOf(g.color),
      size: size ? pixels(g.size, 100) : null,
    });
  }
  const menuText = group("menuText");
  keep("menuText", {
    color: colorOf(menuText.color),
    size: pixels(menuText.size, 100),
    hoverColor: colorOf(menuText.hoverColor),
    hoverSize: pixels(menuText.hoverSize, 100),
  });
  const equalizer = group("equalizer");
  keep("equalizer", {
    color: colorOf(equalizer.color),
    glow: colorOf(equalizer.glow),
  });
  return styles;
}

/** The menu's layout (menu_pos, menu_width, menu_height) and 헤더사용 (use_header). */
export function designLayout(saved: Record<string, any> = {}) {
  return {
    useHeader: saved?.useHeader !== false,
    menuPosition: saved?.menuPosition === "top" ? "top" : "left",
    // The original installs 200 and 50 (install_db.php's css_config).
    menuWidth: pixels(saved?.menuWidth, 600) || 200,
    menuHeight: pixels(saved?.menuHeight, 400) || 50,
    backgroundSize: choice(saved?.backgroundSize, SIZES),
  };
}

const url = (value: string) => `url("${value}")`;
const rule = (selectors: string[], declarations: (string | null | false)[]) => {
  const body = declarations.filter(Boolean);
  if (!body.length) return "";
  // "::before" is the page's own layer (theme.css's html.single:before).
  const scoped = selectors.map((selector) =>
    selector.startsWith("::")
      ? `body.site.designed${selector}`
      : `body.site.designed ${selector}`,
  );
  return `${scoped.join(",\n")} {\n${body.map((line) => `  ${line};`).join("\n")}\n}\n`;
};
const media = (query: string, text: string) =>
  text ? `@media ${query} {\n${text}}\n` : "";
const DESKTOP = "(min-width: 1025px)";
const MOBILE = "(max-width: 1024px)";

function background(g: Record<string, any> | undefined) {
  if (!g) return [];
  return [
    g.image && `background-image: ${url(g.image)}`,
    g.color && `background-color: ${g.color}`,
    g.repeat && `background-repeat: ${g.repeat}`,
    g.position && `background-position: ${g.position}`,
    g.size && `background-size: ${g.size}`,
    g.fixed && `background-attachment: ${g.fixed}`,
  ];
}
function box(g: Record<string, any> | undefined) {
  if (!g) return [];
  return [
    g.background && `background-color: ${g.background}`,
    g.color && `color: ${g.color}`,
    // design_form_css.php writes a side only when it is checked.
    ...(g.borderSides ?? []).flatMap((side) => [
      g.borderColor && `border-${side}-color: ${g.borderColor}`,
      g.borderStyle && `border-${side}-style: ${g.borderStyle}`,
      g.borderWidth !== undefined && `border-${side}-width: ${g.borderWidth}px`,
    ]),
  ];
}
function corners(g: Record<string, any> | undefined) {
  if (!g) return [];
  return [
    g.topLeft !== undefined && `border-top-left-radius: ${g.topLeft}px`,
    g.topRight !== undefined && `border-top-right-radius: ${g.topRight}px`,
    g.bottomRight !== undefined &&
      `border-bottom-right-radius: ${g.bottomRight}px`,
    g.bottomLeft !== undefined &&
      `border-bottom-left-radius: ${g.bottomLeft}px`,
  ];
}
const text = (g: Record<string, any> | undefined) =>
  g ? [g.color && `color: ${g.color}`, g.size && `font-size: ${g.size}px`] : [];

/** Where each part of the original's design is in neo-avocado's page. */
const PARTS: Record<string, string[]> = {
  // .theme-list and .theme-form: tables and the account and profile sheets.
  table: [".ledger", ".account-info", ".character-fields"],
  listHeader: [".ledger th"],
  listBody: [".ledger td"],
  formHeader: [".account-info dt", ".character-fields dt"],
  formBody: [".account-info dd", ".character-fields dd"],
  // The mmb skin: .board-notice, #log_list, .ui-pic, .ui-comment, .item-comment.
  notice: ["#boardDescription"],
  logList: ["#logs"],
  logItem: ["#logs > .log"],
  logImage: [".log .log-picture"],
  comments: [".log .log-discussion"],
  comment: [".comment"],
  subMenu: [".tabs"],
  // .theme-box.
  box: [
    ".card",
    '[role="status"]:not(:empty)',
    ".log-title",
    ".log-discussion > .meta",
  ],
  input: [
    'input:not([type="checkbox"]):not([type="radio"])',
    "textarea",
    "select",
  ],
  author: [".comment .author", ".log-discussion > .meta .author"],
  ownerName: [".comment.owner > .author"],
  date: [".comment time", ".log-discussion > .meta time"],
  link: [".other-site-link"],
  call: [".member-call"],
  logLink: [".log-link"],
  hashTag: [".hash-tag"],
};

/**
 * The design CSS (design_form_css.php) of `saved`, the design settings: the
 * menu's sizes, and a rule for each part the owner set; what they left
 * blank keeps the seeded design (theme.css).
 */
export function designCss(saved: Record<string, any> = {}): string {
  const s = designStyles(saved);
  const layout = designLayout(saved);
  // menu_width and menu_height: the menu column's width, the top bar's height.
  let css = `:root:has(body.site.designed) {\n  --menu-width: ${layout.menuWidth}px;\n  --menu-height: ${layout.menuHeight}px;\n}\n`;
  if (layout.backgroundSize)
    css += rule(["::before"], [`background-size: ${layout.backgroundSize}`]);
  // m_background's own color and placing, on a phone (theme.css's 700px).
  css += media(
    "(max-width: 700px)",
    rule(["::before"], background(s.mobileBackground)),
  );
  css += media(
    DESKTOP,
    rule(["> .top"], background(s.header)) +
      rule([".site-menu"], background(s.menu)),
  );
  css += media(
    MOBILE,
    rule(["> .top"], background(s.mobileHeader)) +
      rule([".site-menu"], background(s.mobileMenu)),
  );
  css += rule(["#logsView"], background(s.board));
  for (const key of [
    "table",
    "listHeader",
    "listBody",
    "formHeader",
    "formBody",
    "notice",
    "logList",
    "logItem",
    "logImage",
    "comments",
    "comment",
    "subMenu",
  ])
    css += rule(PARTS[key], [
      ...box(s[key]),
      s[key]?.margin !== undefined &&
        `margin-bottom: ${s[key].margin}px !important`,
    ]);
  if (s.subMenu) {
    css += rule(
      [".tabs button"],
      [s.subMenu.color && `color: ${s.subMenu.color}`],
    );
    css += rule(
      [
        ".tabs button:hover:not(:disabled)",
        '.tabs button[aria-pressed="true"]',
      ],
      [s.subMenu.hover && `color: ${s.subMenu.hover}`],
    );
  }
  const buttons: [string, string[]][] = [
    ["button", ["button", ".pages .page"]],
    [
      "pointButton",
      ['button[type="submit"]', "#signIn", '.pages .page[aria-current="page"]'],
    ],
    ["etcButton", ["button.etc"]],
  ];
  for (const [key, selectors] of buttons) {
    const g = s[key];
    if (!g) continue;
    css += rule(selectors, [
      g.color && `color: ${g.color}`,
      g.background && `background: ${g.background}`,
      g.borderColor && `border-color: ${g.borderColor}`,
    ]);
    css += rule(
      selectors.map((selector) => `${selector}:hover:not(:disabled)`),
      [
        g.hoverColor && `color: ${g.hoverColor}`,
        g.hoverBackground && `background: ${g.hoverBackground}`,
        g.hoverBorderColor && `border-color: ${g.hoverBorderColor}`,
        (g.hoverColor || g.hoverBackground) && "filter: none",
      ],
    );
  }
  for (const key of ["input", "box"]) {
    const g = s[key];
    if (!g) continue;
    css += rule(PARTS[key], [
      g.background && `background: ${g.background}`,
      g.color && `color: ${g.color}`,
      g.borderColor &&
        (key === "box"
          ? `border: 1px solid ${g.borderColor}`
          : `border-color: ${g.borderColor}`),
      ...corners(g),
    ]);
  }
  if (s.input?.color)
    css += rule(
      ["input::placeholder", "textarea::placeholder"],
      [`color: ${s.input.color}`],
    );
  for (const key of [
    "author",
    "ownerName",
    "date",
    "link",
    "call",
    "logLink",
    "hashTag",
  ])
    css += rule(PARTS[key], text(s[key]));
  if (s.menuText) {
    css += rule([".site-menu a"], text(s.menuText));
    css += rule(
      [".site-menu a:hover", '.site-menu a[aria-current="page"]'],
      text({ color: s.menuText.hoverColor, size: s.menuText.hoverSize }),
    );
  }
  if (s.equalizer)
    css += rule(
      [".bar-equalizer i"],
      [
        s.equalizer.color && `background: ${s.equalizer.color}`,
        s.equalizer.glow && `box-shadow: 0 0 3px 0 ${s.equalizer.glow}`,
      ],
    );
  return css;
}

/** 디자인's colours (design.colors) and the page's variables they set. */
const SITE_COLORS = {
  accent: "--avocado",
  muted: "--pit",
  paper: "--paper",
  ink: "--ink",
  line: "--line",
  surface: "--surface",
};
const hex = (value: unknown): string | null =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
const image = (value: unknown): string | null => {
  try {
    return imageUrl(value);
  } catch {
    return null;
  }
};

/**
 * The page's whole look from the design settings: the <body> classes, the
 * `design` layer (the colours and backgrounds as variables, then designCss)
 * and 사용자 CSS. The site query hands it to the page (app/site.ts), and each
 * page's route writes it into index.html's <head> (previews.ts), so the first
 * paint already has it.
 */
export function designLook(saved: Record<string, any> = {}) {
  const enabled = saved.enabled === true;
  const layout = designLayout(saved);
  const font = ["serif", "mono"].includes(saved.font) ? saved.font : null;
  const classes = enabled
    ? [
        "designed",
        ...(layout.useHeader === false ? ["no-header"] : []),
        ...(layout.menuPosition === "top" ? ["menu-top"] : []),
        ...(font ? [`font-${font}`] : []),
      ]
    : [];
  const vars: Record<string, string> = {};
  if (enabled) {
    for (const [key, variable] of Object.entries(SITE_COLORS))
      if (hex(saved.colors?.[key])) vars[variable] = saved.colors[key];
    const background = image(saved.background);
    if (background) {
      // The owner's picture at its own size, repeated and placed as they
      // chose (background_repeat, background_position).
      vars["--site-background-size"] = "auto";
      vars["--site-background"] = `url("${encodeURI(background)}")`;
    }
    // m_background: a phone's own picture (style.css's narrow layout).
    const mobile = image(saved.mobileBackground);
    if (mobile) {
      vars["--site-mobile-background-size"] = "auto";
      vars["--site-mobile-background"] = `url("${encodeURI(mobile)}")`;
    }
    const repeat = choice(saved.backgroundRepeat, REPEATS);
    if (repeat) vars["--site-background-repeat"] = repeat;
    const position = choice(saved.backgroundPosition, POSITIONS);
    if (position) vars["--site-background-position"] = position;
    if (hex(saved.backgroundColor))
      vars["--site-background-color"] = saved.backgroundColor;
    const header = image(saved.headerBackground);
    if (header)
      vars["--site-header-background"] = `url("${encodeURI(header)}")`;
  }
  const declarations = Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};\n`)
    .join("");
  const rootRule = declarations ? `:root {\n${declarations}}\n` : "";
  return {
    classes,
    layer: enabled ? `@layer design {\n${rootRule}${designCss(saved)}}\n` : "",
    // 사용자 CSS: the owner's own, after the rest, whether 디자인 사용 is on
    // or not.
    customCss:
      typeof saved.customCss === "string"
        ? saved.customCss.slice(0, 50000)
        : "",
    // The owner's own files in Naru's _owner/ folder, which no template
    // update touches: /_owner/style.css before 사용자 CSS, and
    // /_owner/script.js once the page is set up.
    ownerFiles: saved.ownerFiles === true,
  };
}
