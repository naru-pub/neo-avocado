// 기타관리's tools: 데이터 백업·복원 and the owner's grants.
import { moneyText } from "../app/names.js";
import {
  $,
  CALLS,
  itemNames,
  loadReferences,
  owner,
  references,
  run,
} from "./core.js";
import { control, table } from "./views.js";

/* ----------------------------------------------------------- grants --- */

/**
 * 아보·경험치·아이템 지급 (adm/point_list.php, exp_list.php,
 * inventory_list.php): the form, one call for all its recipients, and the
 * last grants.
 */
/**
 * 데이터 백업 and 데이터 복원하기 (adm/data_backup.php, data_restore.php):
 * each category kept as a JSON file, and put back from one.
 */
export async function backupView() {
  const report = $("adminReport");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const list = document.createElement("ul");
  list.className = "backup-list";
  const categories = await owner.query("admin/backup:categories");
  for (const category of categories) {
    const item = document.createElement("li");
    const keep = document.createElement("button");
    keep.type = "button";
    keep.textContent = "백업 내려받기";
    keep.onclick = () =>
      run(async () => {
        keep.disabled = true;
        try {
          const tables = [];
          for (let part = 0; part < category.tables; part += 1) {
            const rows = [];
            let after = 0;
            let table = "";
            do {
              status.textContent = `${category.label} 백업 중… (${rows.length}행)`;
              const page = await owner.query("admin/backup:rows", {
                category: category.id,
                part,
                after,
              });
              table = page.table;
              rows.push(...page.rows);
              after = page.next;
            } while (after !== null);
            tables.push({ table, rows });
          }
          const file = new Blob(
            [
              JSON.stringify({
                format: "neo-avocado-backup",
                category: category.id,
                at: new Date().toISOString(),
                tables,
              }),
            ],
            { type: "application/json" },
          );
          const link = document.createElement("a");
          link.href = URL.createObjectURL(file);
          const stamp = new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/\D/g, "");
          link.download = `data_backup_${category.id}_${stamp}.json`;
          link.click();
          URL.revokeObjectURL(link.href);
          status.textContent = `${category.label}을(를) 백업했습니다.`;
        } finally {
          keep.disabled = false;
        }
      });
    const choose = document.createElement("input");
    choose.type = "file";
    choose.accept = "application/json,.json";
    choose.setAttribute("aria-label", `${category.label} 복원 파일`);
    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "복원하기";
    restore.onclick = () =>
      run(async () => {
        const file = choose.files?.[0];
        if (!file) return (status.textContent = "복원할 백업 파일을 고르세요.");
        let backup;
        try {
          backup = JSON.parse(await file.text());
        } catch {
          return (status.textContent = "백업 파일을 읽을 수 없습니다.");
        }
        if (
          backup?.format !== "neo-avocado-backup" ||
          backup.category !== category.id ||
          !Array.isArray(backup.tables) ||
          backup.tables.length !== category.tables
        )
          return (status.textContent = `${category.label}의 백업 파일이 아닙니다.`);
        if (
          !confirm(
            `${category.label}의 지금 자료를 지우고 ${backup.at ?? "백업"} 시점으로 되돌릴까요? 되돌릴 수 없습니다.`,
          )
        )
          return;
        restore.disabled = true;
        try {
          for (const [part, { rows }] of backup.tables.entries()) {
            const all = Array.isArray(rows) ? rows : [];
            let done = 0;
            // The first call empties the category's rows of the table.
            do {
              status.textContent = `${category.label} 복원 중… (${done}/${all.length}행)`;
              await owner.mutate("admin/backup:restore", {
                category: category.id,
                part,
                clear: done === 0,
                rows: all.slice(done, done + 200),
              });
              done += 200;
            } while (done < all.length);
          }
          status.textContent = `${category.label}을(를) 복원했습니다.`;
        } finally {
          restore.disabled = false;
        }
      });
    item.append(
      Object.assign(document.createElement("strong"), {
        textContent: category.label,
      }),
      " ",
      keep,
      " ",
      choose,
      " ",
      restore,
    );
    list.append(item);
  }
  report.replaceChildren(list, status);
}
export async function grantsView() {
  const report = $("adminReport");
  const form = document.createElement("form");
  form.className = "card grant-form";
  const kind = document.createElement("select");
  kind.append(
    new Option(itemNames.moneyName, "money"),
    new Option(itemNames.expName, "exp"),
    new Option("아이템", "item"),
  );
  // The items to give, and the names the log shows.
  const { items } = await loadReferences();
  const item = document.createElement("select");
  item.append(
    ...items.map((row) => new Option(row.data.name ?? row.id, row.id)),
  );
  const target = document.createElement("select");
  target.append(new Option("개별 지급", "one"), new Option("전체 지급", "all"));
  const name = document.createElement("input");
  name.maxLength = 40;
  const value = document.createElement("input");
  value.type = "number";
  value.step = "1";
  value.required = true;
  const memo = document.createElement("input");
  memo.maxLength = 200;
  const nameLabel = control("", name);
  const itemLabel = control("아이템", item);
  const valueLabel = control("", value);
  const describe = () => {
    nameLabel.firstChild.textContent =
      kind.value === "money" ? "회원 닉네임" : "캐릭터 이름";
    nameLabel.hidden = target.value === "all";
    name.required = target.value === "one";
    itemLabel.hidden = kind.value !== "item";
    item.required = kind.value === "item";
    valueLabel.firstChild.textContent =
      kind.value === "item" ? "개수 (1~100)" : "양 (깎으려면 음수)";
  };
  kind.onchange = target.onchange = describe;
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "지급";
  form.append(
    control("종류", kind),
    control("지급 유형", target),
    nameLabel,
    itemLabel,
    valueLabel,
    control("내용", memo),
    submit,
    status,
  );
  describe();
  const log = document.createElement("ul");
  log.className = "grant-log";
  const showLog = async () => {
    const page = await owner.query(CALLS.history.list, {
      actor: "grant",
      size: 20,
    });
    log.replaceChildren(
      ...page.documents.map((row) => {
        const item = document.createElement("li");
        const who =
          references.profiles.find((profile) => profile.id === row.data.owner)
            ?.data.nick ?? row.data.owner;
        const character = row.data.character
          ? references.characters.find(
              (entry) => entry.id === row.data.character,
            )?.data.name
          : null;
        item.textContent = `${new Date(row.data.at).toLocaleString("ko-KR")} · ${character ? `${character} (${who})` : who} · ${
          row.data.kind === "exp"
            ? `${itemNames.expName} ${row.data.expDelta > 0 ? "+" : ""}${row.data.expDelta}`
            : row.data.kind === "grant"
              ? `${row.data.name} ${row.data.count}개`
              : `${row.data.delta > 0 ? "+" : ""}${moneyText(itemNames, row.data.delta)}`
        }${row.data.memo ? ` · ${row.data.memo}` : ""}`;
        return item;
      }),
    );
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      const amount = Number(value.value);
      if (!Number.isSafeInteger(amount) || amount === 0)
        return (status.textContent = "0이 아닌 정수를 입력하세요.");
      if (kind.value === "item" && (amount < 1 || amount > 100))
        return (status.textContent = "아이템은 1~100개 지급할 수 있습니다.");
      if (
        target.value === "all" &&
        !confirm(
          `전체 ${kind.value === "money" ? "회원" : "승인된 캐릭터"}에게 ${
            kind.value === "item"
              ? `${item.selectedOptions[0]?.textContent} ${amount}개를`
              : `${amount}만큼`
          } 지급할까요?`,
        )
      )
        return;
      submit.disabled = true;
      try {
        // One call gives to everyone it names.
        const { granted, skipped } = await owner.mutate(
          "economy/grants:grant",
          {
            kind: kind.value,
            target: target.value,
            name: name.value.trim(),
            value: amount,
            memo: memo.value.trim(),
            ...(kind.value === "item" ? { item: item.value } : {}),
          },
        );
        status.textContent = `${granted}명 지급${skipped ? `, ${skipped}명은 가진 것보다 많이 깎을 수 없어 건너뜀` : ""}. 끝났습니다.`;
        await showLog();
      } finally {
        submit.disabled = false;
      }
    });
  };
  const heading = document.createElement("h3");
  heading.textContent = "최근 지급 기록";
  report.replaceChildren(form, heading, log);
  await showLog();
}
