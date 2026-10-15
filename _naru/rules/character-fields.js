// Profile field definitions, without the admin-only ones, whose values
// members never see.
export function scope() {
  return {
    all: [{ ne: ["deleted", true] }, { ne: ["visibility", "admin"] }],
  };
}

export function canWrite() {
  return false;
}
