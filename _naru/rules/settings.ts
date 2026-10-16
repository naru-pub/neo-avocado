// The community settings members' pages need (message cost, starting stat
// points, the shop's categories, NPC and greeting, the rules a new member
// agrees to and the reserved nicknames), and nothing else the admin keeps
// there. A signed-in Naru member reads them before joining the community.
import { RESERVED_NICKS } from "../modules/shared.js";
import type {
  Data,
  PresentArgs,
  ReadCtx,
  Where,
} from "../modules/naru-types.js";

export const queryable: string[] = [];

export function readable(): Where {
  return { eq: [{ metadata: "id" }, "community"] };
}

export function present(ctx: ReadCtx, { document }: PresentArgs): Data {
  return {
    initialStatPoints: document.data.initialStatPoints ?? 0,
    messageCost: document.data.messageCost ?? 0,
    shopCategories: document.data.shopCategories ?? "일반, 이벤트",
    shopNpc: document.data.shopNpc ?? null,
    shopGreeting: document.data.shopGreeting ?? "",
    characterCreation: document.data.characterCreation !== false,
    characterEditing: document.data.characterEditing !== false,
    characterLimit: Number.isSafeInteger(document.data.characterLimit)
      ? document.data.characterLimit
      : 1,
    // 커뮤니티 활동 규칙 and 캐릭터 유의사항 (cf_stipulation, cf_privacy),
    // shown when joining (skin/member/basic/register.skin.php).
    stipulation:
      typeof document.data.stipulation === "string"
        ? document.data.stipulation
        : "",
    characterNotice:
      typeof document.data.characterNotice === "string"
        ? document.data.characterNotice
        : "",
    reservedNicks:
      typeof document.data.reservedNicks === "string"
        ? document.data.reservedNicks
        : RESERVED_NICKS,
  };
}

export function canWrite(): boolean {
  return false;
}
