// The community settings members' pages need (message cost, starting stat
// points, the shop's categories, NPC and greeting), and nothing else the admin
// keeps there.
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
  };
}

export function canWrite(): boolean {
  return false;
}
