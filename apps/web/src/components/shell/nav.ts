// The app's information architecture, organized by PD job rather than by table.
// An item without `href` is planned but not built — shown so the shape of the product
// is visible, never as a dead link.
export interface NavItem {
  label: string;
  href?: string;
  /** Key into the counts the layout passes the sidebar, shown as a badge when non-zero. */
  badge?: "inbox" | "changes" | "drift";
  /** Shown only to people who have this permission (the server enforces it regardless). */
  needs?: "manage_people" | "staff";
  /** Shown only at stations whose logs reach air this way (stations.playout). */
  playout?: "radiodj" | "file";
  /** The label at a 'file' (tier-0) station, where there is no Runner. */
  fileLabel?: string;
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
      { label: "RadioDJ drift", href: "/music/drift", badge: "drift", playout: "radiodj" },
      { label: "Library", href: "/music/library" },
      { label: "Lifecycle", href: "/music/lifecycle" },
    ],
  },
  {
    label: "Format",
    items: [{ label: "Clocks", href: "/format/clocks" }, { label: "Week grid", href: "/format/grid" }, { label: "Rules", href: "/format/rules" }],
  },
  { label: "Logs", items: [{ label: "Logs", href: "/logs" }] },
  { label: "Reports", items: [{ label: "As-run", href: "/reports/as-run", playout: "radiodj" }] },
  {
    label: "Station",
    items: [
      { label: "Library & Runner", href: "/station", fileLabel: "Setup" },
      { label: "People", href: "/station/people", needs: "manage_people" },
      { label: "Settings", href: "/station/settings" },
    ],
  },
  { label: "Rotavox", items: [{ label: "Staff", href: "/staff", needs: "staff" }] },
];
