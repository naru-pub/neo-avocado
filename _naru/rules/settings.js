// The community settings members' pages need (message cost, starting stat
// points, the shop's categories, NPC and greeting), and nothing else the admin
// keeps there.
export const queryable = [];

export function readable() {
  return { eq: [{ metadata: "id" }, "community"] };
}

export function present(ctx, { document }) {
  return {
    initialStatPoints: document.data.initialStatPoints ?? 0,
    messageCost: document.data.messageCost ?? 0,
    shopCategories: document.data.shopCategories ?? "일반, 이벤트",
    shopNpc: document.data.shopNpc ?? null,
    shopGreeting: document.data.shopGreeting ?? "",
  };
}

export function canWrite() {
  return false;
}
