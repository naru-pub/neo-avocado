// 화면: light, dark, or the visitor's system setting (nothing stored). A plain
// script in <head>, so the page never flashes the wrong colours; the choice
// is this browser's own and covers the community and its admin page.
(() => {
  const KEY = "neo-avocado-scheme";
  const root = document.documentElement;
  const apply = (choice) => {
    if (choice === "light" || choice === "dark") root.dataset.theme = choice;
    else delete root.dataset.theme;
  };
  try {
    apply(localStorage.getItem(KEY));
  } catch {
    // Storage blocked: follow the system.
  }
  document.addEventListener("DOMContentLoaded", () => {
    const choice = document.getElementById("schemeChoice");
    if (!choice) return;
    choice.value = root.dataset.theme ?? "";
    choice.onchange = () => {
      apply(choice.value);
      try {
        if (choice.value) localStorage.setItem(KEY, choice.value);
        else localStorage.removeItem(KEY);
      } catch {
        // Kept for this page only.
      }
    };
  });
})();
