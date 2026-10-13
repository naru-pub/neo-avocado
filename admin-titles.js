const P = "neo_avocado_";
async function maybe(collection, id) {
  try {
    return await collection.get(id);
  } catch (error) {
    if (error.code === "NOT_FOUND") return null;
    throw error;
  }
}
/** Grant/revoke idempotently; each chunk guards title, characters and progression. */
export async function applyTitles(
  owner,
  titleId,
  { action, characterIds = [], allApproved = false },
  progress = () => {},
) {
  if (!["grant", "revoke"].includes(action))
    throw new Error("지급 또는 회수를 선택하세요.");
  const ids = new Set(characterIds);
  if (allApproved) {
    for await (const page of owner
      .collection(`${P}character_state`)
      .pages({ filter: { approved: true }, size: 100 }))
      for (const row of page.documents) ids.add(row.id);
  }
  if (!ids.size) throw new Error("대상 캐릭터가 없습니다.");
  let completed = 0;
  const targets = [...ids];
  try {
    for (let start = 0; start < targets.length; start += 20) {
      const title = await owner.collection(`${P}titles`).get(titleId);
      if (title.data.deleted)
        throw new Error("삭제 중인 타이틀은 지급·회수할 수 없습니다.");
      const operations = [
        {
          collection: `${P}titles`,
          set: {
            id: titleId,
            data: title.data,
            condition: { revision: title.revision },
          },
        },
      ];
      for (const id of targets.slice(start, start + 20)) {
        const character = await owner.collection(`${P}characters`).get(id);
        if (character.data.deleted)
          throw new Error("삭제 중인 캐릭터는 대상에서 제외하세요.");
        const previous = await maybe(
          owner.collection(`${P}character_state`),
          id,
        );
        if (allApproved && previous?.data.approved !== true)
          throw new Error(
            "캐릭터 승인이 바뀌었습니다. 대상을 다시 확인하세요.",
          );
        let data = previous?.data;
        if (!data) {
          if (action === "revoke") continue;
          const settings = await maybe(
            owner.collection(`${P}settings`),
            "community",
          );
          const points = settings?.data.initialStatPoints ?? 0;
          if (!Number.isSafeInteger(points) || points < 0)
            throw new Error("기본 포인트 설정을 확인하세요.");
          data = {
            owner: character.data.owner ?? character.createdBy ?? null,
            character: id,
            points,
            exp: 0,
            stats: {},
            titles: [],
          };
        }
        const titles = new Set(data.titles ?? []);
        if (action === "grant") titles.add(titleId);
        else titles.delete(titleId);
        const next = {
          ...data,
          titles: [...titles],
          ...(action === "revoke" && data.activeTitle === titleId
            ? { activeTitle: null }
            : {}),
        };
        operations.push({
          collection: `${P}characters`,
          set: {
            id,
            data: character.data,
            condition: { revision: character.revision },
          },
        });
        operations.push({
          collection: `${P}character_state`,
          set: {
            id,
            data: next,
            condition: previous
              ? { revision: previous.revision }
              : { absent: true },
          },
        });
      }
      await owner.batch(operations);
      completed += targets.slice(start, start + 20).length;
      progress({ completed, total: targets.length });
    }
  } catch (error) {
    error.message = `${completed}/${targets.length}명 처리 후 중단: ${error.message}. 다시 실행하면 중복 지급되지 않습니다.`;
    throw error;
  }
  return { completed, total: targets.length };
}

/** A durable marker blocks new grants; interrupted cleanup resumes on next delete. */
export async function deleteTitle(
  owner,
  titleId,
  progress = () => {},
  finalize = async () => {},
) {
  const collection = owner.collection(`${P}titles`);
  let title = await collection.get(titleId);
  if (!title.data.deleted) {
    await collection.set(
      titleId,
      { ...title.data, deleted: true },
      { condition: { revision: title.revision } },
    );
    title = await collection.get(titleId);
  }
  let completed = 0;
  for (;;) {
    const targets = [];
    for await (const page of owner
      .collection(`${P}character_state`)
      .pages({ size: 100 })) {
      for (const row of page.documents) {
        if (
          row.data.titles?.includes(titleId) ||
          row.data.activeTitle === titleId
        )
          targets.push(row);
        if (targets.length === 20) break;
      }
      if (targets.length === 20) break;
    }
    const operations = targets.map((row) => ({
      collection: `${P}character_state`,
      set: {
        id: row.id,
        data: {
          ...row.data,
          titles: (row.data.titles ?? []).filter((id) => id !== titleId),
          ...(row.data.activeTitle === titleId ? { activeTitle: null } : {}),
        },
        condition: { revision: row.revision },
      },
    }));
    const done = targets.length < 20;
    operations.push({
      collection: `${P}titles`,
      ...(done
        ? { delete: { id: titleId, condition: { revision: title.revision } } }
        : {
            set: {
              id: titleId,
              data: title.data,
              condition: { revision: title.revision },
            },
          }),
    });
    if (done) await finalize(title, operations);
    await owner.batch(operations);
    completed += targets.length;
    progress({ completed, done });
    if (done) return { completed };
    title = await collection.get(titleId);
  }
}
