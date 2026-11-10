// What was typed in Search: one value for the desktop header's field and the
// search page, kept while pages come and go; and what the search is
// narrowed to (all, or one kind).

import { signal } from "nsh";
import type { SearchFilter } from "../backend/types";

export const query = signal("");

/** What Search shows: everything, or one kind with more pages. */
export const filter = signal<"all" | SearchFilter>("all");
