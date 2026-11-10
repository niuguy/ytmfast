// Whether the user has folded the desktop sidebar into its rail,
// remembered between runs.

import { signal, Storage } from "nsh";

const KEY = "visual:sidebar-collapsed";
const collapsed = signal(false);

Storage.getItem(KEY)
  .then((saved) => collapsed.set(saved === "1"))
  .catch(() => {});

/** Whether the sidebar is folded by the user (tracked). */
export const sidebarCollapsed = () => collapsed();

/** Folds the sidebar, or opens it again, and remembers it. */
export function toggleSidebar(): void {
  const next = !collapsed();
  collapsed.set(next);
  Storage.setItem(KEY, next ? "1" : "0").catch(() => {});
}
