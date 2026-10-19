// 데이터 백업지점 설정 and 데이터 복원하기 (adm/data_backup.php,
// data_restore.php): the tables of each of the original's categories, with
// the rows of each that belong to it and its columns, so a backup holds just
// those rows and a restore writes no other column.
export interface BackupPart {
  table: string;
  /** Which of the table's rows the category holds. */
  where: string;
  columns: readonly string[];
}

export const BACKUP: Record<string, { label: string; parts: BackupPart[] }> = {
  // css_config: the design.
  design: {
    label: "디자인",
    parts: [
      { table: "settings", where: "key = 'design'", columns: ["key", "value"] },
    ],
  },
  // content (site_menu, site_main): the menus and the main page.
  content: {
    label: "메뉴·메인 화면",
    parts: [
      {
        table: "menus",
        where: "1",
        columns: [
          "id",
          "name",
          "link",
          "parent",
          "sort_order",
          "level",
          "enabled",
          "mobile",
          "new_window",
          "created_at",
        ],
      },
      {
        table: "content",
        where: "id IN ('site_main', 'site_menu')",
        columns: [
          "id",
          "name",
          "enabled",
          "read_level",
          "format",
          "body",
          "mobile_body",
          "header_image",
          "footer_image",
        ],
      },
    ],
  },
  // character, article_value, status_character, character_closthes,
  // has_title: the characters with their values and stats, wardrobes and
  // titles held.
  characters: {
    label: "캐릭터 (프로필 값·능력치·옷장·보유 타이틀)",
    parts: [
      {
        table: "characters",
        where: "1",
        columns: [
          "id",
          "owner",
          "name",
          "side",
          "class",
          "profile",
          "type",
          "state",
          "image",
          "head",
          "body",
          "outfit",
          "fields",
          "exp",
          "points",
          "stats",
          "active_title",
          "purchases",
          "explore_day",
          "explore_count",
          "created_at",
          "version",
        ],
      },
      {
        table: "character_titles",
        where: "1",
        columns: ["id", "character_id", "title_id"],
      },
      {
        table: "wardrobe",
        where: "1",
        columns: ["id", "owner", "character_id", "name", "image"],
      },
    ],
  },
  // status: the stat definitions.
  stats: {
    label: "능력치 정의",
    parts: [
      {
        table: "stats",
        where: "1",
        columns: [
          "id",
          "name",
          "initial",
          "max",
          "min",
          "help",
          "sort_order",
          "use_max",
        ],
      },
    ],
  },
  // exp: the experience history.
  exp: {
    label: "경험치 내역",
    parts: [
      {
        table: "history",
        where: "exp_delta IS NOT NULL",
        columns: HISTORY_COLUMNS(),
      },
    ],
  },
  // point: balances and the money history.
  money: {
    label: "화폐 (잔액·내역)",
    parts: [
      {
        table: "wallets",
        where: "1",
        columns: ["member", "balance", "last_daily"],
      },
      {
        table: "history",
        where: "delta IS NOT NULL AND exp_delta IS NULL",
        columns: HISTORY_COLUMNS(),
      },
    ],
  },
};

function HISTORY_COLUMNS() {
  return [
    "id",
    "owner",
    "kind",
    "at",
    "delta",
    "balance",
    "exp_delta",
    "exp",
    "memo",
    "actor",
    "item_id",
    "inventory_id",
    "character_id",
    "character_name",
    "entry_id",
    "details",
  ];
}

/** Rows a backup reads, and a restore writes, a call. */
export const BACKUP_ROWS = 200;
