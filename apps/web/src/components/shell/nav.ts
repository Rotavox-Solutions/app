// The app's information architecture, organized by PD job rather than by table.
// An item without `href` is planned but not built — shown so the shape of the product
// is visible, never as a dead link.
export interface NavItem {
  label: string;
  href?: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  { label: "", items: [{ label: "Today", href: "/today" }] },
  {
    label: "Music",
    items: [{ label: "Categories", href: "/music/categories" }, { label: "Library" }, { label: "Lifecycle" }],
  },
  {
    label: "Format",
    items: [{ label: "Clocks" }, { label: "Week grid" }, { label: "Rules" }],
  },
  { label: "Logs", items: [{ label: "Logs", href: "/logs" }] },
  { label: "Reports", items: [{ label: "As-run", href: "/reports/as-run" }] },
  { label: "Station", items: [{ label: "Settings" }] },
];
