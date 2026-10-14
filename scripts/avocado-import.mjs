// Converts an AvocadoEdition MySQL dump into neo-avocado documents.
//
//   node scripts/avocado-import.mjs dump.sql --members members.json \
//     --media-base https://files.example.com --out import.json
//
// members.json maps old member IDs (mb_id) to Naru member IDs, which members
// see on the admission page (가입 문의용 회원 번호). Content of unmapped members
// is kept with their old nickname but belongs to nobody. Uploaded files are
// not copied: addresses under /data/ are rewritten onto --media-base, where
// the owner hosts (or re-uploads) the old data/ folder. Passwords, e-mail,
// IP addresses and other PHP account data are never read.
//
// Load import.json from admin.html → "AvocadoEdition 가져오기".
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tagFields, plainText } from "../_naru/modules/shared.js";

const P = "neo_avocado_";

/** Reads every table's rows from a mysqldump: CREATE TABLE columns and INSERT values. */
export function parseDump(sql) {
  const tables = new Map();
  const columns = new Map();
  for (const match of sql.matchAll(
    /CREATE TABLE (?:IF NOT EXISTS )?`([^`]+)` \(([\s\S]*?)\n\)/g,
  ))
    columns.set(
      match[1],
      [...match[2].matchAll(/^\s*`([^`]+)`/gm)].map((column) => column[1]),
    );
  const insert = /INSERT INTO `([^`]+)`(?: \(([^)]*)\))? VALUES\s*/g;
  let found;
  while ((found = insert.exec(sql))) {
    const name = found[1];
    const names = found[2]
      ? found[2].split(",").map((part) => part.trim().replace(/`/g, ""))
      : columns.get(name);
    if (!names) throw new Error(`No columns known for ${name}.`);
    let index = insert.lastIndex;
    const rows = tables.get(name) ?? [];
    tables.set(name, rows);
    for (;;) {
      while (/\s/.test(sql[index])) index++;
      if (sql[index] !== "(") break;
      index++;
      const values = [];
      for (;;) {
        while (/\s/.test(sql[index])) index++;
        if (sql[index] === "'") {
          let value = "";
          index++;
          for (;;) {
            const char = sql[index++];
            if (char === undefined) throw new Error("Unterminated string.");
            if (char === "\\") {
              const next = sql[index++];
              value +=
                { n: "\n", r: "\r", t: "\t", 0: "\0", Z: "\x1a" }[next] ?? next;
            } else if (char === "'") {
              if (sql[index] === "'") {
                value += "'";
                index++;
              } else break;
            } else value += char;
          }
          values.push(value);
        } else {
          let end = index;
          while (!/[,)]/.test(sql[end])) end++;
          const raw = sql.slice(index, end).trim();
          values.push(raw === "NULL" ? null : Number(raw));
          index = end;
        }
        while (/\s/.test(sql[index])) index++;
        if (sql[index] === ",") {
          index++;
          continue;
        }
        if (sql[index] === ")") {
          index++;
          break;
        }
        throw new Error(`Unexpected ${sql[index]} in ${name}.`);
      }
      rows.push(Object.fromEntries(names.map((key, n) => [key, values[n]])));
      while (/\s/.test(sql[index])) index++;
      if (sql[index] === ",") index++;
      else break;
    }
    insert.lastIndex = index;
  }
  return tables;
}

const kstMillis = (value) => {
  if (!value || String(value).startsWith("0000")) return null;
  const stamp = Date.parse(`${String(value).replace(" ", "T")}+09:00`);
  return Number.isFinite(stamp) ? stamp : null;
};
const localTime = (value) =>
  value && !String(value).startsWith("0000")
    ? String(value).replace(" ", "T").slice(0, 16)
    : "";
const level = (value, fallback = 2) =>
  Math.min(10, Math.max(1, Number(value) || fallback));
const int = (value) =>
  Number.isSafeInteger(Number(value)) ? Number(value) : 0;
const str = (value, max) => String(value ?? "").slice(0, max);

/**
 * Converts parsed tables to `{ documents, warnings, unmapped }`. Documents
 * have stable IDs (av-…), so a second import of the same dump skips what the
 * first one wrote. Logs and comments are in posting order: Naru sets each
 * document's createdAt when it is written, so order is all that survives;
 * the original time is kept in `postedAt`.
 */
export function convert(tables, { members = {}, mediaBase = "", prefix } = {}) {
  const warnings = [];
  const documents = [];
  const put = (collection, id, data) =>
    documents.push({ collection: `${P}${collection}`, id, data });
  prefix ??=
    [...tables.keys()]
      .map((name) => name.match(/^([a-z0-9]+_)board$/)?.[1])
      .find(Boolean) ?? "avo_";
  const table = (name) => tables.get(`${prefix}${name}`) ?? [];
  const base = mediaBase.replace(/\/+$/, "");
  /** An HTTPS address for an old file, or null. */
  const media = (value) => {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const path = text.match(/^(?:https?:\/\/[^/]+)?(\/?data\/.+)$/)?.[1];
    if (path && base) return `${base}/${path.replace(/^\//, "")}`;
    if (/^https:\/\/[^\s@]+$/.test(text)) return text;
    warnings.push(`File without an HTTPS address skipped: ${text}`);
    return null;
  };
  const owner = (mbId) =>
    mbId && Object.hasOwn(members, mbId) ? members[mbId] : null;
  const nicks = new Map(table("member").map((row) => [row.mb_id, row.mb_nick]));
  const unmapped = new Set();
  /** Who wrote something: a mapped member, else the old nickname. */
  const authorship = (mbId, name) => {
    const id = owner(mbId);
    if (id) return { owner: id };
    if (mbId) {
      unmapped.add(mbId);
      return {
        owner: null,
        importedAuthor: { name: str(nicks.get(mbId) ?? name ?? mbId, 20) },
      };
    }
    return { owner: null, guest: { name: str(name || "손님", 20) } };
  };

  for (const row of table("member")) {
    const id = owner(row.mb_id);
    if (!id) {
      unmapped.add(row.mb_id);
      continue;
    }
    put("profiles", id, {
      owner: id,
      nick: str(row.mb_nick || row.mb_id, 20),
      acceptMessages: true,
      commentAlerts: true,
    });
    put("members", id, {
      role: "member",
      level: level(row.mb_level),
      importedFrom: row.mb_id,
    });
    if (int(row.mb_point) > 0)
      put("wallets", id, { balance: int(row.mb_point), lastDaily: null });
  }

  const sides = new Map(
    table("character_side").map((r) => [r.si_id, r.si_name]),
  );
  const classes = new Map(
    table("character_class").map((r) => [r.cl_id, r.cl_name]),
  );
  const characters = new Map();
  for (const row of table("character")) characters.set(String(row.ch_id), row);
  const characterId = (id) =>
    characters.has(String(id)) ? `av-ch-${id}` : null;
  const characterOwner = (id) => owner(characters.get(String(id))?.mb_id);

  // Profile form definitions (adm/character_article_list.php).
  const fieldCodes = new Map();
  for (const row of table("article")) {
    const code = /^[a-z][a-z0-9_]{0,31}$/.test(row.ar_code)
      ? row.ar_code
      : `f_${row.ar_id}`;
    fieldCodes.set(row.ar_code, { code, type: row.ar_type });
    put("character_fields", code, {
      label: str(row.ar_name || code, 40),
      type:
        { file: "image", url: "url", select: "select", textarea: "textarea" }[
          row.ar_type
        ] ?? "text",
      options: String(row.ar_text ?? "")
        .split("||")
        .map((option) => option.trim())
        .filter(Boolean),
      help: str(row.ar_help, 200),
      order: int(row.ar_order),
      visibility: { S: "owner", H: "admin" }[row.ar_secret] ?? "public",
      required: false,
    });
  }
  const values = new Map();
  for (const row of table("article_value")) {
    const field = fieldCodes.get(row.ar_code);
    if (!field || !row.av_value) continue;
    const value =
      field.type === "file" || field.type === "url"
        ? media(row.av_value)
        : str(row.av_value, field.type === "textarea" ? 2000 : 200);
    if (!value) continue;
    const sheet = values.get(String(row.ch_id)) ?? {};
    sheet[field.code] = value;
    values.set(String(row.ch_id), sheet);
  }

  // Titles, stats and levels.
  for (const row of table("character_title"))
    put("titles", `av-ti-${row.ti_id}`, {
      name: str(row.ti_title, 80),
      image: media(row.ti_img) ?? "",
      description: "",
    });
  const stats = table("status");
  for (const row of stats)
    put("stat_config", `st${row.st_id}`, {
      name: str(row.st_name, 40),
      initial: Math.max(0, int(row.st_min)),
      max: Math.max(int(row.st_min), int(row.st_max) || 999),
    });
  for (const row of table("level_setting"))
    put("levels", `av-lv-${row.lv_id}`, {
      name: str(row.lv_name, 40),
      exp: Math.max(0, int(row.lv_exp)),
    });

  const outfits = new Map();
  for (const row of table("character_closthes"))
    if (int(row.cl_use) === 1)
      outfits.set(String(row.ch_id), `av-cl-${row.cl_id}`);
  for (const [chId, row] of characters) {
    const id = `av-ch-${chId}`;
    const author = authorship(row.mb_id, row.ch_name);
    if (!author.owner)
      warnings.push(`Character ${row.ch_name} has no mapped owner.`);
    put("characters", id, {
      ...author,
      name: str(row.ch_name, 40),
      side: str(sides.get(int(row.ch_side)) ?? "", 40),
      profile: "",
      image: media(row.ch_head) ?? media(row.ch_thumb),
      type: ["main", "sub", "npc"].includes(row.ch_type) ? row.ch_type : "main",
      state:
        row.ch_state === "승인"
          ? "approved"
          : row.ch_state === "대기"
            ? "submitted"
            : "editing",
      fields: values.get(chId) ?? {},
      ...(outfits.has(chId) ? { outfit: outfits.get(chId) } : {}),
    });
    const titles = table("has_title").filter((t) => String(t.ch_id) === chId);
    const allocated = {};
    for (const stat of table("status_character").filter(
      (s) => String(s.ch_id) === chId,
    )) {
      const definition = stats.find((s) => s.st_id === stat.st_id);
      if (!definition) continue;
      const max = Math.max(0, int(stat.sc_max));
      allocated[`st${stat.st_id}`] = {
        allocated: Math.max(0, max - Math.max(0, int(definition.st_min))),
        damage: Math.max(0, max - Math.max(0, int(stat.sc_value))),
      };
    }
    put("character_state", id, {
      owner: author.owner,
      character: id,
      approved: row.ch_state === "승인",
      side: str(sides.get(int(row.ch_side)) ?? "", 40),
      class: str(classes.get(int(row.ch_class)) ?? "", 40),
      exp: Math.max(0, int(row.ch_exp)),
      points: Math.max(0, int(row.ch_point)),
      stats: allocated,
      titles: titles.map((t) => `av-ti-${t.ti_id}`),
      ...(titles.find((t) => int(t.hi_use) === 1)
        ? {
            activeTitle: `av-ti-${titles.find((t) => int(t.hi_use) === 1).ti_id}`,
          }
        : {}),
    });
  }
  for (const row of table("character_closthes")) {
    const character = characterId(row.ch_id);
    const image = media(row.cl_path);
    if (!character || !image) continue;
    put("wardrobe", `av-cl-${row.cl_id}`, {
      owner: characterOwner(row.ch_id),
      character,
      name: str(row.cl_subject || "의상", 40),
      image,
    });
  }
  for (const row of table("couple")) {
    const first = characterId(row.co_left);
    const second = characterId(row.co_right);
    if (first && second)
      put("couples", `av-co-${row.co_id}`, {
        first,
        second,
        since: String(row.co_date ?? "").startsWith("0000")
          ? ""
          : str(row.co_date, 10),
        order: int(row.co_order),
      });
  }
  for (const row of table("relation_character")) {
    const character = characterId(row.ch_id);
    const target = characterId(row.re_ch_id);
    if (!character || !target) continue;
    const link = String(row.rm_link ?? "").trim();
    put("relations", `av-rm-${row.rm_id}`, {
      owner: characterOwner(row.ch_id),
      character,
      target,
      affinity: Math.max(-100, Math.min(100, int(row.rm_like))),
      memo: str(row.rm_memo, 2000),
      link: /^https:\/\/\S+$/.test(link) ? link : "",
      order: Math.max(0, int(row.rm_order)),
    });
  }

  // Items, shop listings, recipes, draw tables and inventories.
  const shop = new Map(table("shop").map((row) => [String(row.it_id), row]));
  const items = new Map(table("item").map((row) => [String(row.it_id), row]));
  for (const [itId, row] of items) {
    const listing = shop.get(itId);
    put("items", `av-it-${itId}`, {
      name: str(row.it_name, 80),
      description: str(row.it_content, 2000),
      image: media(row.it_img) ?? "",
      price: listing ? Math.max(0, int(listing.sh_money)) : 0,
      hidden: !listing || int(listing.sh_use) !== 1,
      sellable: int(row.it_use_sell) === 1,
      sellPrice: Math.max(0, int(row.it_sell)),
      giftable: true,
      usable: row.it_use === "Y",
      reusable: int(row.it_use_ever) === 1,
    });
    if (row.it_type && row.it_type !== "일반")
      warnings.push(
        `Item ${row.it_name}: effect ${row.it_type} needs setting again in 아이템.`,
      );
  }
  for (const row of table("item_recepi")) {
    const counts = new Map();
    for (const part of String(row.re_item_order ?? "").split("||"))
      if (items.has(part)) counts.set(part, (counts.get(part) ?? 0) + 1);
    if (!items.has(String(row.it_id)) || !counts.size) continue;
    put("recipes", `av-re-${row.re_id}`, {
      name: str(items.get(String(row.it_id)).it_name, 80),
      description: "",
      item: `av-it-${row.it_id}`,
      cost: 0,
      hidden: int(row.re_use) !== 1,
      ingredients: [...counts].map(([item, count]) => ({
        item: `av-it-${item}`,
        count,
      })),
    });
  }
  for (const row of table("item_explorer")) {
    const weight = int(row.ie_per_e) - int(row.ie_per_s) + 1;
    if (!items.has(String(row.it_id)) || weight <= 0) continue;
    put("gacha", `av-ie-${row.ie_id}`, {
      source: `av-it-${row.it_id}`,
      item: items.has(String(row.re_it_id)) ? `av-it-${row.re_it_id}` : null,
      weight,
    });
  }
  for (const row of table("inventory")) {
    const member = characterOwner(row.ch_id);
    if (!member || !items.has(String(row.it_id))) {
      warnings.push(`Inventory ${row.in_id} skipped: no mapped owner or item.`);
      continue;
    }
    put("inventory", `av-in-${row.in_id}`, {
      owner: member,
      item: `av-it-${row.it_id}`,
      name: str(row.it_name, 80),
      character: characterId(row.ch_id),
      from: "import",
    });
  }

  // Boards, logs and comments.
  for (const board of table("board")) {
    const mmb = /mmb/.test(board.bo_skin ?? "");
    put("boards", board.bo_table, {
      name: str(board.bo_subject || board.bo_table, 120),
      description: "",
      kind: mmb ? "image" : "text",
      enabled: true,
      listLevel: level(board.bo_list_level, 1),
      readLevel: level(board.bo_read_level, 1),
      writeLevel: level(board.bo_write_level, 1),
      commentLevel: level(board.bo_comment_level, 1),
      categories: int(board.bo_use_category)
        ? String(board.bo_category_list ?? "")
            .split("|")
            .map((name) => name.trim())
            .filter(Boolean)
            .slice(0, 20)
        : [],
      secret:
        ["off", "optional", "required"][int(board.bo_use_secret)] ?? "off",
      html: int(board.bo_use_dhtml_editor) === 1,
      actions: mmb,
    });
    const files = new Map(
      table("board_file")
        .filter(
          (file) => file.bo_table === board.bo_table && int(file.bf_no) === 0,
        )
        .map((file) => [String(file.wr_id), file.bf_file]),
    );
    const rows = (tables.get(`${prefix}write_${board.bo_table}`) ?? [])
      .slice()
      .sort(
        (a, b) =>
          (kstMillis(a.wr_datetime) ?? 0) - (kstMillis(b.wr_datetime) ?? 0) ||
          int(a.wr_id) - int(b.wr_id),
      );
    let next = 1;
    for (const row of rows) {
      const id = `av-${board.bo_table}-${row.wr_id}`;
      const option = String(row.wr_option ?? "");
      const character = int(row.ch_id) ? characterId(row.ch_id) : null;
      const speaker = character
        ? {
            character,
            name: str(characters.get(String(row.ch_id)).ch_name, 40),
            type: characters.get(String(row.ch_id)).ch_type || "main",
            title: null,
            titleImage: null,
            portrait: media(characters.get(String(row.ch_id)).ch_head),
          }
        : null;
      const dice = int(row.wr_dice1) > 0 && int(row.wr_dice2) > 0;
      const common = {
        ...authorship(row.mb_id, row.wr_name),
        ...(speaker ? { character, speaker } : {}),
        ...(dice
          ? { dice: true, rolls: [int(row.wr_dice1), int(row.wr_dice2)] }
          : { dice: false }),
        postedAt: kstMillis(row.wr_datetime),
      };
      const html = /html[12]/.test(option);
      if (int(row.wr_is_comment)) {
        const actions = [];
        const log = String(row.wr_log ?? "").split("||");
        if (log[0] === "S")
          actions.push({
            type: "explore",
            item: log[1] === "S" ? `av-it-${log[2]}` : null,
            name: log[1] === "S" ? log[3] : null,
            image: null,
          });
        if (log[0] === "H")
          actions.push({
            type: "combine",
            success: log[1] === "S",
            item: log[1] === "S" ? `av-it-${log[2]}` : null,
            name: log[1] === "S" ? log[3] : null,
            image: null,
            materials: [],
          });
        put("comments", id, {
          ...common,
          logId: `av-${board.bo_table}-${row.wr_parent}`,
          text: str(html ? plainText(row.wr_content) : row.wr_content, 500),
          ...(actions.length ? { actions } : {}),
        });
        continue;
      }
      const number = Math.abs(int(row.wr_num)) || next;
      next = Math.max(next, number + 1);
      const text = html
        ? str(row.wr_content, 12000)
        : str(row.wr_content, 2000);
      if (String(row.wr_content ?? "").length > text.length)
        warnings.push(`Log ${id} was cut to fit.`);
      const image =
        row.wr_type === "URL"
          ? media(row.wr_url)
          : files.has(String(row.wr_id))
            ? media(
                `data/file/${board.bo_table}/${files.get(String(row.wr_id))}`,
              )
            : null;
      put("logs", id, {
        ...common,
        board: board.bo_table,
        title:
          row.wr_subject === "--|UPLOADING|--" ? "" : str(row.wr_subject, 120),
        category: str(row.ca_name, 40),
        secret: /secret/.test(option) || int(row.wr_secret) === 1,
        format: html ? "html" : "text",
        text,
        image,
        number,
        ...tagFields(html ? plainText(text) : text),
      });
    }
    put("counters", board.bo_table, { next });
  }

  // Site content, navigation, banners and emoticons.
  for (const row of table("content")) {
    const id = /^[a-zA-Z0-9_-]{1,64}$/.test(row.co_id) ? row.co_id : null;
    if (!id) continue;
    put("content", id, {
      name: str(row.co_subject || id, 120),
      enabled: true,
      readLevel: 1,
      format: int(row.co_html) ? "html" : "text",
      body: str(row.co_content, 12000),
      mobileBody: str(row.co_mobile_content, 12000),
      headerImage: "",
      footerImage: "",
    });
  }
  const menus = table("menu");
  for (const row of menus) {
    const link = String(row.me_link ?? "");
    const target =
      link.match(/bo_table=([\w-]+)/)?.[1] !== undefined
        ? `board:${link.match(/bo_table=([\w-]+)/)[1]}`
        : link.match(/co_id=([\w-]+)/)?.[1] !== undefined
          ? `content:${link.match(/co_id=([\w-]+)/)[1]}`
          : /^https:\/\/\S+$/.test(link)
            ? link
            : null;
    if (!target) {
      warnings.push(`Menu ${row.me_name} (${link}) needs a new link.`);
      continue;
    }
    const code = String(row.me_code ?? "");
    const parent =
      code.length === 4
        ? menus.find((other) => other.me_code === code.slice(0, 2))
        : null;
    put("menus", `av-me-${row.me_id}`, {
      name: str(row.me_name, 40),
      link: target,
      parent: parent ? `av-me-${parent.me_id}` : null,
      order: Math.max(0, int(row.me_order)),
      level: 1,
      enabled: int(row.me_use) === 1,
      mobile: int(row.me_mobile_use) === 1,
      newWindow: row.me_target === "blank",
    });
  }
  for (const [name, place] of [
    ["banner", "main"],
    ["intro", "intro"],
  ])
    for (const row of table(name)) {
      const image = media(row.bn_img);
      if (!image) continue;
      put("banners", `av-${place}-${row.bn_id}`, {
        place,
        image,
        mobileImage: media(row.bn_m_img) ?? "",
        alt: str(row.bn_alt, 200),
        url: /^https:\/\/\S+$/.test(row.bn_url ?? "") ? row.bn_url : "",
        newWindow: int(row.bn_new_win) === 1,
        startsAt: localTime(row.bn_begin_time),
        endsAt: localTime(row.bn_end_time),
        order: Math.max(0, int(row.bn_order)),
        level: 1,
        enabled: true,
      });
    }
  for (const row of table("emoticon")) {
    const image = media(row.me_img);
    if (image)
      put("emoticons", `av-em-${row.me_id}`, {
        name: str(row.me_text, 40),
        image,
      });
  }
  for (const row of table("memo")) {
    const from = owner(row.me_send_mb_id);
    const to = owner(row.me_recv_mb_id);
    if (!from || !to) continue;
    put("messages", `av-memo-${row.me_id}`, {
      from,
      to,
      body: str(row.me_memo, 5000),
      sentAt: kstMillis(row.me_send_datetime) ?? 0,
      readAt: kstMillis(row.me_read_datetime),
    });
  }
  return { documents, warnings, unmapped: [...unmapped].sort() };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args.splice(index, 2)[1] : undefined;
  };
  const membersPath = option("--members");
  const mediaBase = option("--media-base") ?? "";
  const out = option("--out") ?? "import.json";
  const [dump] = args;
  if (!dump) {
    console.error(
      "Usage: node scripts/avocado-import.mjs dump.sql [--members members.json] [--media-base https://…] [--out import.json]",
    );
    process.exit(2);
  }
  const members = membersPath
    ? JSON.parse(await readFile(membersPath, "utf8"))
    : {};
  const result = convert(parseDump(await readFile(dump, "utf8")), {
    members,
    mediaBase,
  });
  await writeFile(
    out,
    JSON.stringify({ format: "neo-avocado-import", version: 1, ...result }),
  );
  console.log(
    `${result.documents.length} documents → ${out}; ${result.unmapped.length} unmapped members; ${result.warnings.length} warnings.`,
  );
  for (const warning of result.warnings.slice(0, 50))
    console.log(`- ${warning}`);
}
