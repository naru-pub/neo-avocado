import { releaseMediaReferences } from "./media-cleanup.js";
import { applyTitles, deleteTitle } from "./admin-titles.js";
import { resumeCleanup } from "./admin-cleanup.js";
import { config } from "./config.js";
import {
  models,
  scopes,
  buildRecord,
  fieldValue,
  walletWrites,
  titleHoldings,
} from "./admin-model.js";
const $ = (id) => document.getElementById(id);
let grantTitleId;
let naru,
  owner,
  section = "couples",
  cursor = null,
  selected = null;
let references = {
  characters: [],
  titles: [],
  stats: [],
  items: [],
  profiles: [],
};
function message(error) {
  return error?.code === "CONFLICT"
    ? "다른 창에서 바뀌었습니다. 다시 불러온 뒤 수정하세요."
    : error?.code === "NOT_FOUND"
      ? "컬렉션을 먼저 만들거나 삭제된 자료를 확인하세요."
      : error?.code === "ACCESS_DENIED"
        ? "사이트 소유자 권한이 필요합니다."
        : error?.code === "AUTH_REQUIRED"
          ? "운영자 로그인이 끝났습니다. 다시 로그인하세요."
          : (error?.message ?? "처리하지 못했습니다.");
}
async function run(action) {
  try {
    await action();
  } catch (error) {
    $("adminStatus").textContent = message(error);
  }
}
async function all(collection) {
  const rows = [];
  for await (const page of owner.collection(collection).pages({ size: 100 }))
    rows.push(...page.documents);
  return rows;
}
async function load({ more = false } = {}) {
  const requestedSection = section;
  const model = models[section];
  $("adminHelp").textContent = model.help;
  $("adminNew").hidden = Boolean(model.readOnly);
  $("holdingsSearchLabel").hidden = !model.holdings;
  let page;
  if (model.holdings) {
    references.titles = await all("neo_avocado_titles");
    references.characters = await all("neo_avocado_characters");
    const rows = titleHoldings(
      await all(model.collection),
      references.characters,
      references.titles,
      $("holdingsSearch").value,
    );
    const start = more ? Number(cursor) : 0;
    page = {
      documents: rows.slice(start, start + 50),
      nextCursor: start + 50 < rows.length ? String(start + 50) : null,
    };
  } else
    page = await owner.collection(model.collection).list({
      size: 50,
      after: more ? cursor : null,
      ...(model.cleanup
        ? {
            filter:
              model.cleanup === "media" ? { cleanup: true } : { deleted: true },
          }
        : {}),
    });
  if (requestedSection !== section || !owner) return;
  if (!more) $("adminRows").replaceChildren();
  for (const row of page.documents) {
    const li = document.createElement("li");
    if (model.holdings) {
      li.append(
        `${row.character} · ${row.title}${row.active ? " · 착용 중" : ""} `,
      );
      if (typeof row.image === "string" && row.image.startsWith("https://")) {
        const image = document.createElement("img");
        image.src = row.image;
        image.alt = row.title;
        image.loading = "lazy";
        image.className = "title-image";
        li.prepend(image);
      }
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.textContent = "회수";
      revoke.onclick = () =>
        run(async () => {
          revoke.disabled = true;
          try {
            const previous = row.state;
            await owner.collection("neo_avocado_character_state").set(
              previous.id,
              {
                ...previous.data,
                titles: (previous.data.titles ?? []).filter(
                  (id) => id !== row.titleId,
                ),
                ...(previous.data.activeTitle === row.titleId
                  ? { activeTitle: null }
                  : {}),
              },
              { condition: { revision: previous.revision } },
            );
            $("adminStatus").textContent = "타이틀을 회수했습니다.";
            await load();
          } finally {
            revoke.disabled = false;
          }
        });
      li.append(revoke);
      $("adminRows").append(li);
      continue;
    }
    if (model.cleanup) {
      li.append(`${row.data.name ?? row.data.title ?? row.id} · 삭제 정리 중 `);
      const resume = document.createElement("button");
      resume.type = "button";
      resume.textContent = "정리 계속";
      resume.onclick = () =>
        run(async () => {
          resume.disabled = true;
          try {
            const result = await resumeCleanup(owner, model.cleanup, row.id);
            $("adminStatus").textContent = result.done
              ? "정리를 완료했습니다."
              : "일부 자료를 정리했습니다. 정리 계속을 눌러 이어가세요.";
            await load();
          } finally {
            resume.disabled = false;
          }
        });
      li.append(resume);
      $("adminRows").append(li);
      continue;
    }
    if (model.readOnly) {
      li.textContent = `${new Date(row.data.at).toLocaleString("ko-KR")} · ${row.data.owner} · ${row.data.kind}${row.data.delta !== undefined ? ` · ${row.data.delta} 아보` : ""}${row.data.memo ? ` · ${row.data.memo}` : ""}`;
      $("adminRows").append(li);
      continue;
    }
    li.append(
      row.data.name ??
        references.characters.find((character) => character.id === row.id)?.data
          .name ??
        references.profiles.find((profile) => profile.id === row.id)?.data
          .nick ??
        row.id,
      " ",
    );
    if (section === "wallets") li.append(`${row.data.balance} 아보 `);
    if (section === "inventory")
      li.append(
        `${references.profiles.find((profile) => profile.id === row.data.owner)?.data.nick ?? row.data.owner} · ${references.characters.find((character) => character.id === row.data.character)?.data.name ?? "회원 인벤토리"} `,
      );
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "수정";
    edit.onclick = () => run(() => openForm(row));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.hidden = Boolean(model.noDelete);
    remove.textContent = "삭제";
    remove.onclick = () =>
      run(async () => {
        if (!confirm("이 자료를 삭제할까요?")) return;
        if (section === "titles") {
          await deleteTitle(
            owner,
            row.id,
            ({ completed }) => {
              $("adminStatus").textContent =
                `${completed}명의 타이틀을 회수했습니다.`;
            },
            (title, operations) =>
              releaseMediaReferences(
                owner,
                [{ collection: model.collection, document: title }],
                operations,
              ),
          );
          await load();
          return;
        }
        const operations = [
          {
            collection: model.collection,
            delete: { id: row.id, condition: { revision: row.revision } },
          },
        ];
        await releaseMediaReferences(
          owner,
          [{ collection: model.collection, document: row }],
          operations,
        );
        await owner.batch(operations);
        await load();
      });
    li.append(edit, " ", remove);
    if (section === "titles") {
      const grant = document.createElement("button");
      grant.type = "button";
      grant.textContent = "지급·회수";
      grant.disabled = Boolean(row.data.deleted);
      if (row.data.deleted)
        li.append(" (삭제 정리 중: 삭제를 다시 눌러 재개) ");
      grant.onclick = () =>
        run(async () => {
          grantTitleId = row.id;
          $("titleGrantHeading").textContent = `${row.data.name} 지급·회수`;
          $("titleGrantStatus").textContent = "";
          $("titleGrantCharacters").replaceChildren();
          for (const character of await all("neo_avocado_characters")) {
            if (character.data.deleted) continue;
            const option = document.createElement("option");
            option.value = character.id;
            option.textContent = `${character.data.name} (${character.id})`;
            $("titleGrantCharacters").append(option);
          }
          $("titleGrantForm").hidden = false;
        });
      li.append(" ", grant);
    }
    $("adminRows").append(li);
  }
  cursor = page.nextCursor;
  $("adminMore").hidden = !cursor;
}
async function openForm(row = null) {
  const requestedSection = section;
  references = {
    characters: await all("neo_avocado_characters"),
    titles: (await all("neo_avocado_titles")).filter(
      (row) => !row.data.deleted,
    ),
    stats: await all("neo_avocado_stat_config"),
    items: await all("neo_avocado_items"),
    profiles: await all("neo_avocado_profiles"),
  };
  if (requestedSection !== section || !owner) return;
  selected = row;
  const model = models[section];
  $("adminFormTitle").textContent = `${model.label} ${row ? "수정" : "등록"}`;
  $("adminFormStatus").textContent = "";
  $("adminFields").replaceChildren();
  const fields = [
    {
      key: "id",
      label: model.characterKey
        ? "캐릭터"
        : model.memberKey
          ? "회원"
          : "ID (등록 후 변경 불가)",
      type: model.characterKey
        ? "character"
        : model.memberKey
          ? "profile"
          : "text",
      required: true,
    },
    ...model.fields,
  ];
  if (model.characterKey)
    for (const definition of references.stats)
      fields.push(
        {
          key: `allocated:${definition.id}`,
          label: `${definition.data.name} 배분 포인트`,
          type: "number",
          default: row?.data.stats?.[definition.id]?.allocated ?? 0,
        },
        {
          key: `damage:${definition.id}`,
          label: `${definition.data.name} 받은 피해량`,
          type: "number",
          default:
            row?.data.stats?.[definition.id]?.damage ??
            (row?.data.stats?.[definition.id]?.max ?? definition.data.initial) -
              (row?.data.stats?.[definition.id]?.current ??
                definition.data.initial),
        },
      );
  for (const field of fields) {
    const value =
      field.key === "id"
        ? (row?.id ?? model.fixedId)
        : section === "quests" && field.key === "images"
          ? (row?.data.images?.join("\n") ?? "")
          : (fieldValue(row?.data, field.key) ?? field.default);
    if (field.type === "ingredients") {
      const group = document.createElement("fieldset");
      group.dataset.ingredients = field.key;
      const legend = document.createElement("legend");
      legend.textContent = field.label;
      group.append(legend);
      const addRow = (entry = {}) => {
        const line = document.createElement("div");
        line.className = "ingredient-row";
        const item = document.createElement("select");
        item.className = "ingredient-item";
        item.setAttribute("aria-label", "재료 아이템");
        item.required = true;
        for (const reference of references.items) {
          const option = document.createElement("option");
          option.value = reference.id;
          option.textContent = reference.data.name;
          item.append(option);
        }
        if (
          entry.item &&
          !references.items.some((reference) => reference.id === entry.item)
        ) {
          const option = document.createElement("option");
          option.value = entry.item;
          option.textContent = `${entry.item} (삭제됨: 다시 선택하세요)`;
          item.append(option);
        }
        if (entry.item) item.value = entry.item;
        const count = document.createElement("input");
        count.className = "ingredient-count";
        count.type = "number";
        count.min = "1";
        count.step = "1";
        count.value = entry.count ?? 1;
        count.required = true;
        count.setAttribute("aria-label", "재료 개수");
        line.append(item, count);
        if (field.consumes) {
          const consumeLabel = document.createElement("label");
          const consume = document.createElement("input");
          consume.type = "checkbox";
          consume.className = "ingredient-consume";
          consume.checked = Boolean(entry.consume);
          consumeLabel.append(consume, "소모");
          line.append(consumeLabel);
        }
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "재료 빼기";
        remove.onclick = () => line.remove();
        line.append(remove);
        group.insertBefore(line, add);
      };
      const add = document.createElement("button");
      add.type = "button";
      add.textContent = "재료 추가";
      add.onclick = () => addRow();
      group.append(add);
      for (const entry of value ?? []) addRow(entry);
      $("adminFields").append(group);
      continue;
    }
    const label = document.createElement("label");
    label.textContent = field.label;
    const isSelect = [
      "character",
      "titles",
      "item",
      "stat",
      "title",
      "choice",
      "profile",
    ].includes(field.type);
    const input = document.createElement(
      isSelect ? "select" : field.type === "textarea" ? "textarea" : "input",
    );
    input.name = field.key;
    input.required = Boolean(field.required);
    if (!isSelect && field.type !== "textarea")
      input.type = ["optional-number", "decimal"].includes(field.type)
        ? "number"
        : field.type === "tokens"
          ? "text"
          : (field.type ?? "text");
    if (["number", "optional-number", "decimal"].includes(field.type)) {
      input.min = "0";
      input.step = field.type === "decimal" ? "any" : "1";
    }
    if (isSelect) {
      input.multiple = field.type === "titles";
      if (field.optional) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "선택하지 않음";
        input.append(option);
      }
      const choices = field.options
        ? field.options.map(([id, name]) => ({ id, data: { name } }))
        : references[
            field.type === "character"
              ? "characters"
              : field.type === "stat"
                ? "stats"
                : ["title", "titles"].includes(field.type)
                  ? "titles"
                  : field.type === "profile"
                    ? "profiles"
                    : "items"
          ];
      for (const optionRow of choices) {
        const option = document.createElement("option");
        option.value = optionRow.id;
        option.textContent = optionRow.data.name ?? optionRow.data.nick;
        option.selected =
          field.type === "titles"
            ? (value ?? []).includes(optionRow.id)
            : value === optionRow.id;
        input.append(option);
      }
      if (
        !input.multiple &&
        value &&
        !choices.some((optionRow) => optionRow.id === value)
      ) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = `${value} (삭제됨: 다시 선택하세요)`;
        input.append(option);
      }
      if (!input.multiple && value !== undefined && value !== null)
        input.value = value;
    } else if (field.type === "checkbox") input.checked = Boolean(value);
    else
      input.value =
        field.type === "tokens" ? (value ?? []).join(", ") : (value ?? "");
    if (field.max) input.maxLength = field.max;
    if (field.key === "id" && (row || model.fixedId)) {
      input.value = row?.id ?? model.fixedId;
      input.disabled = true;
    }
    label.append(input);
    $("adminFields").append(label);
  }
  $("adminForm").hidden = false;
}
$("adminForm").onsubmit = async (event) => {
  event.preventDefault();
  const button = $("adminForm").querySelector('[type="submit"]');
  button.disabled = true;
  $("adminSection").disabled = true;
  $("adminNew").disabled = true;
  try {
    const values = {};
    for (const input of $("adminFields").querySelectorAll(
      "input,select,textarea",
    ))
      if (input.name)
        values[input.name] =
          input.type === "checkbox"
            ? input.checked
            : input.multiple
              ? [...input.selectedOptions].map((option) => option.value)
              : input.value;
    for (const group of $("adminFields").querySelectorAll("[data-ingredients]"))
      values[group.dataset.ingredients] = [
        ...group.querySelectorAll(".ingredient-row"),
      ].map((line) => ({
        item: line.querySelector(".ingredient-item").value,
        count: line.querySelector(".ingredient-count").value,
        consume: line.querySelector(".ingredient-consume")?.checked ?? false,
      }));
    const record = buildRecord(section, values, selected, references);
    let saved;
    if (section === "wallets") {
      const results = await owner.batch(
        walletWrites(
          record,
          selected,
          values.note,
          Date.now(),
          crypto.randomUUID(),
        ),
      );
      saved = { ...record, ...results[0] };
    } else if (
      selected?.data.imageId &&
      selected.data.image !== record.data.image
    ) {
      delete record.data.imageId;
      const collection = models[section].collection;
      const operations = [
        {
          collection,
          set: {
            id: record.id,
            data: record.data,
            condition: { revision: selected.revision },
          },
        },
      ];
      await releaseMediaReferences(
        owner,
        [{ collection, document: selected }],
        operations,
      );
      const results = await owner.batch(operations);
      saved = { ...record, ...results[0] };
    } else
      saved = await owner
        .collection(models[section].collection)
        .set(record.id, record.data, {
          condition: selected
            ? { revision: selected.revision }
            : { absent: true },
        });
    selected = saved;
    $("adminForm").hidden = true;
    $("adminStatus").textContent = "저장했습니다.";
    await load();
  } catch (error) {
    $("adminFormStatus").textContent = message(error);
  } finally {
    button.disabled = false;
    $("adminSection").disabled = false;
    $("adminNew").disabled = false;
  }
};
$("adminCancel").onclick = () => {
  $("adminForm").hidden = true;
};
$("adminNew").onclick = () => run(() => openForm());
$("adminMore").onclick = () => run(() => load({ more: true }));
$("adminSection").onchange = () =>
  run(async () => {
    section = $("adminSection").value;
    $("adminForm").hidden = true;
    $("titleGrantForm").hidden = true;
    await load();
  });
$("adminSignIn").onclick = () =>
  run(() => naru.auth.signIn({ collections: scopes, mediaDelete: true }));
$("adminSignOut").onclick = () =>
  run(async () => {
    await owner.signOut();
    owner = null;
    $("adminWorkspace").hidden = true;
    $("adminWelcome").hidden = false;
  });
await run(async () => {
  const { createNaru } = await import("https://naru.pub/sdk/1.1.0/naru.js");
  naru = createNaru(config.site ? { site: config.site } : undefined);
  for (const [name, model] of Object.entries(models)) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = model.label;
    $("adminSection").append(option);
  }
  $("adminSection").value = section;
  owner = await naru.auth.session();
  if (!owner) return;
  $("adminWelcome").hidden = true;
  $("adminWorkspace").hidden = false;
  references.characters = await all("neo_avocado_characters");
  references.profiles = await all("neo_avocado_profiles");
  await load();
});

$("titleGrantCancel").onclick = () => {
  $("titleGrantForm").hidden = true;
};
$("titleGrantForm").onsubmit = async (event) => {
  event.preventDefault();
  const controls = [
    ...$("titleGrantForm").querySelectorAll("button,input,select"),
    $("adminSection"),
    $("adminSignOut"),
  ];
  controls.forEach((control) => {
    control.disabled = true;
  });
  try {
    const result = await applyTitles(
      owner,
      grantTitleId,
      {
        action: $("titleGrantAction").value,
        allApproved: $("titleGrantAll").checked,
        characterIds: $("titleGrantAll").checked
          ? []
          : [...$("titleGrantCharacters").selectedOptions].map(
              (option) => option.value,
            ),
      },
      ({ completed, total }) => {
        $("titleGrantStatus").textContent =
          `${completed}/${total}명 처리했습니다.`;
      },
    );
    $("titleGrantStatus").textContent =
      `${result.completed}명에게 적용했습니다.`;
  } catch (error) {
    $("titleGrantStatus").textContent = error.message ?? message(error);
  } finally {
    controls.forEach((control) => {
      control.disabled = false;
    });
  }
};

$("holdingsFind").onclick = () => run(() => load());
$("holdingsSearch").onkeydown = (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    run(() => load());
  }
};
