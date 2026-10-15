// Profile field definitions, without the admin-only ones, whose values
// members never see.
export function readable() {
  return {
    all: [{ ne: ["deleted", true] }, { ne: ["visibility", "admin"] }],
  };
}

export function canWrite() {
  return false;
}

// Until Naru reads `readable`: rules exported `scope` before 1.1.0 named it so.
export const scope = readable;
