import {
  Bug,
  CloudDownload,
  Copy,
  Database,
  FileText,
  FolderOpen,
  FolderTree,
  Headphones,
  LayoutDashboard,
  Palette,
  Smartphone,
  Terminal,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { TabKey } from "./types";

export interface SectionConfig {
  key: TabKey;
  /** URL segment: /settings/<slug> */
  slug: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

export interface SectionLink {
  label: string;
  icon: LucideIcon;
  to: string;
  description: string;
}

export interface SectionGroup {
  label: string;
  sections: SectionConfig[];
  links?: SectionLink[];
}

export const SECTION_GROUPS: SectionGroup[] = [
  {
    label: "Library",
    sections: [
      { key: "overview", slug: "overview", label: "Overview", icon: LayoutDashboard, description: "Live status, recent activity and library health." },
      { key: "library", slug: "libraries", label: "Libraries", icon: FolderTree, description: "Libraries, storage paths and scans." },
      { key: "appearance", slug: "appearance", label: "Appearance", icon: Palette, description: "What listeners see in the catalog and on Home." },
    ],
    links: [
      { label: "File Manager", icon: FolderOpen, to: "/files", description: "Browse and organise files on disk." },
      { label: "Duplicates", icon: Copy, to: "/duplicates", description: "Find and merge duplicate books." },
      { label: "Missing", icon: CloudDownload, to: "/missing", description: "Audible titles you own that aren't in the library." },
    ],
  },
  {
    label: "People",
    sections: [
      { key: "users", slug: "users", label: "Users", icon: Users, description: "Accounts, roles and password resets." },
      { key: "sessions", slug: "sessions", label: "Listening sessions", icon: Headphones, description: "Who listened to what, where and for how long." },
      { key: "reports", slug: "reports", label: "Reports", icon: Bug, description: "Issues reported by listeners." },
    ],
  },
  {
    label: "Server",
    sections: [
      { key: "system", slug: "system", label: "System", icon: Database, description: "Backups, storage, integrations and maintenance." },
      { key: "scripts", slug: "scripts", label: "Scripts", icon: Terminal, description: "Run approved maintenance scripts." },
      { key: "mobile", slug: "mobile-app", label: "Mobile app", icon: Smartphone, description: "Publish the Azure Player APK." },
      { key: "logs", slug: "logs", label: "Logs", icon: FileText, description: "Application logs, request traces and errors." },
    ],
  },
];

export const SECTIONS: SectionConfig[] = SECTION_GROUPS.flatMap((group) => group.sections);

export const findSectionBySlug = (slug: string | undefined) =>
  slug ? SECTIONS.find((section) => section.slug === slug) ?? null : null;

export const sectionPath = (key: TabKey) => {
  const section = SECTIONS.find((item) => item.key === key);
  return `/settings/${section?.slug ?? key}`;
};
