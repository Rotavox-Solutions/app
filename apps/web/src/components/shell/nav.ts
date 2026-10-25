// The app's information architecture, organized by PD job rather than by table.
// An item without `href` is planned but not built — shown so the shape of the product
// is visible, never as a dead link.
export interface NavItem {
  label: string;
  href?: string;
  /** Key into the counts the layout passes the sidebar, shown as a badge when non-zero. */
  badge?: "inbox" | "changes";
  /** Shown only to people who have this permission (the server enforces it regardless). */
  needs?: "manage_people" | "staff";
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  { label: "", items: [{ label: "Today", href: "/today" }] },
  {
    label: "Music",
    items: [
      { label: "Categories", href: "/music/categories" },
      { label: "Inbox", href: "/music/inbox", badge: "inbox" },
      { label: "Changes", href: "/music/changes", badge: "changes" },
      { label: "Library" },
      { label: "Lifecycle" },
    ],
  },
  {
    label: "Format",
    items: [{ label: "Clocks" }, { label: "Week grid" }, { label: "Rules" }],
  },
  { label: "Logs", items: [{ label: "Logs", href: "/logs" }] },
  { label: "Reports", items: [{ label: "As-run", href: "/reports/as-run" }] },
  {
    label: "Station",
    items: [
      { label: "Library & Runner", href: "/station" },
      { label: "People", href: "/station/people", needs: "manage_people" },
      { label: "Settings" },
    ],
  },
  { label: "Rotavox", items: [{ label: "Staff", href: "/staff", needs: "staff" }] },
];
