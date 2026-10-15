// The community settings members' pages need, and nothing else the admin
// keeps there.
export const queryable = [];

export function scope() {
  return { eq: [{ metadata: "id" }, "community"] };
}

export function present(ctx, { document }) {
  return {
    initialStatPoints: document.data.initialStatPoints ?? 0,
    messageCost: document.data.messageCost ?? 0,
  };
}

export function canWrite() {
  return false;
}
