// The owner's reports (접속자 집계, 활동량), drawn as tables with their filters.
import { koreanDay, VISIT_BREAKDOWNS } from "./reports.js";
import {
  $,
  CALLS,
  cursor,
  loadReferences,
  owner,
  reportFilters,
  run,
  setCursor,
} from "./core.js";
import { adminRoute } from "./main.js";

/* ---------------------------------------------------------- reports --- */

/** A labelled control for a report's filter bar. */
export function control(text, element) {
  const label = document.createElement("label");
  label.append(text, element);
  return label;
}
export function dateInput(value) {
  const input = document.createElement("input");
  input.type = "date";
  input.value = value;
  return input;
}
/** A plain table of `rows` under `headings`. */
export function table(headings, rows) {
  const element = document.createElement("table");
  element.className = "report";
  const head = element.createTHead().insertRow();
  for (const heading of headings) {
    const cell = document.createElement("th");
    cell.textContent = heading;
    head.append(cell);
  }
  const body = element.createTBody();
  for (const cells of rows) {
    const row = body.insertRow();
    for (const value of cells) {
      const cell = row.insertCell();
      if (value instanceof Node) cell.append(value);
      else cell.textContent = String(value);
    }
  }
  if (!rows.length) {
    const cell = body.insertRow().insertCell();
    cell.colSpan = headings.length;
    cell.textContent = "자료가 없습니다.";
  }
  return element;
}
// Declared as functions so they exist when the page opens a report by its
// address, which happens before the module reaches this point.
export function today() {
  return koreanDay(Date.now());
}
export function daysAgo(days) {
  return koreanDay(Date.now() - days * 24 * 3600 * 1000);
}

/** 접속자 집계 (adm/visit_list.php and its tabs), and deleting old days. */
export function visitsView() {
  const [fromDay, toDay, breakdown] = reportFilters;
  const day = (value, fallback) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value : fallback;
  const from = dateInput(day(fromDay, daysAgo(6)));
  const to = dateInput(day(toDay, today()));
  const by = document.createElement("select");
  for (const [value, text] of VISIT_BREAKDOWNS)
    by.append(new Option(text, value));
  const show = document.createElement("button");
  show.type = "button";
  show.textContent = "보기";
  const prune = document.createElement("button");
  prune.type = "button";
  prune.textContent = "시작일 이전 기록 삭제";
  const output = document.createElement("div");
  if (VISIT_BREAKDOWNS.some(([value]) => value === breakdown))
    by.value = breakdown;
  const draw = async () => {
    adminRoute(["visits", from.value, to.value, by.value]);
    const report = await owner.query("admin/visits:report", {
      from: from.value,
      to: to.value,
      by: by.value,
    });
    const top = Math.max(1, ...report.rows.map((row) => row.count));
    const bar = (count) => {
      const meter = document.createElement("meter");
      meter.max = top;
      meter.value = count;
      return meter;
    };
    const summary = document.createElement("p");
    summary.textContent = `접속 ${report.total}회 · 회원 ${report.members}명 · 손님 접속 ${report.guests}회`;
    output.replaceChildren(
      summary,
      table(
        ["구분", "접속 수", ""],
        report.rows.map((row) => [row.label, row.count, bar(row.count)]),
      ),
    );
  };
  show.onclick = () => run(draw);
  prune.onclick = () =>
    run(async () => {
      if (!from.value) return;
      const { older } = await owner.query("admin/visits:report", {
        from: from.value,
        to: to.value,
        by: by.value,
      });
      if (!older) {
        $("adminStatus").textContent = "지울 기록이 없습니다.";
        return;
      }
      if (!confirm(`${from.value} 이전 ${older}일의 접속 기록을 지울까요?`))
        return;
      const { deleted } = await owner.mutate("admin/visits:prune", {
        before: from.value,
      });
      $("adminStatus").textContent = `${deleted}일의 접속 기록을 지웠습니다.`;
      await draw();
    });
  const bar = document.createElement("div");
  bar.className = "report-filters";
  bar.append(
    control("시작일", from),
    control("종료일", to),
    control("보기", by),
    show,
    prune,
  );
  $("adminReport").replaceChildren(bar, output);
  return draw();
}

/** 활동량 관리 (adm/action_list.php): counts per member, warnings editable. */
export async function activityView() {
  const { boards } = await loadReferences();
  const board = document.createElement("select");
  board.append(
    new Option("모든 게시판", ""),
    ...boards.map((row) => new Option(row.data.name, row.id)),
  );
  const [chosen, fromDay, toDay] = reportFilters.map((value) =>
    value === "all" ? "" : value,
  );
  const day = (value, fallback) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value : fallback;
  if ([...board.options].some((option) => option.value === chosen))
    board.value = chosen;
  const from = dateInput(day(fromDay, daysAgo(29)));
  const to = dateInput(day(toDay, today()));
  const show = document.createElement("button");
  show.type = "button";
  show.textContent = "보기";
  const output = document.createElement("div");
  // 100 members a page, 더 보기 for the next, each after the last one read.
  let rows = [];
  let cursor = null;
  const draw = async ({ more = false } = {}) => {
    // "all" stands for every board, which has no ID of its own.
    adminRoute(["activity", board.value || "all", from.value, to.value]);
    // Counted by the server's SQL.
    const page = await owner.query("admin/activity:report", {
      board: board.value,
      from: from.value,
      to: to.value,
      after: more ? cursor : null,
    });
    rows = more ? [...rows, ...page.rows] : page.rows;
    setCursor(page.nextCursor);
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "더 보기";
    next.hidden = !cursor;
    next.onclick = () => run(() => draw({ more: true }));
    output.replaceChildren(
      table(
        [
          "닉네임",
          "대표 캐릭터",
          "로그",
          "댓글",
          "최종 접속",
          "누적 경고",
          "경고 내용",
          "",
        ],
        rows.map((row) => {
          const warnings = document.createElement("input");
          warnings.type = "number";
          warnings.min = "0";
          warnings.value = String(row.warnings);
          const note = document.createElement("input");
          note.maxLength = 1000;
          note.value = row.warningNote;
          const save = document.createElement("button");
          save.type = "button";
          save.textContent = "저장";
          save.onclick = () =>
            run(async () => {
              const count = Number(warnings.value);
              if (!Number.isSafeInteger(count) || count < 0)
                throw new Error("누적 경고는 0 이상의 정수입니다.");
              // The warnings alone: the member's other settings stay.
              await owner.mutate(CALLS.members.save, {
                id: row.id,
                values: { warnings: count, warningNote: note.value.trim() },
                create: !row.member,
              });
              $("adminStatus").textContent =
                `${row.nick}의 경고를 저장했습니다.`;
              await draw();
            });
          return [
            row.nick,
            row.mainCharacter,
            row.logs,
            row.comments,
            row.lastSeen ? new Date(row.lastSeen).toLocaleString("ko-KR") : "",
            warnings,
            note,
            save,
          ];
        }),
      ),
      next,
    );
  };
  show.onclick = () => run(() => draw());
  const bar = document.createElement("div");
  bar.className = "report-filters";
  bar.append(
    control("게시판", board),
    control("시작일", from),
    control("종료일", to),
    show,
  );
  $("adminReport").replaceChildren(bar, output);
  return draw();
}
