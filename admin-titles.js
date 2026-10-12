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
