import type { ReactNode } from "react";

/** Icônes en trait, héritant la couleur du texte (`currentColor`). */
function Icon({ size = 22, fill = "none", strokeWidth = 2, children }: { size?: number; fill?: string; strokeWidth?: number; children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

export const ChevronLeft = ({ size }: { size?: number }) => <Icon size={size}><path d="M15 5l-7 7 7 7" /></Icon>;
export const Check = ({ size, strokeWidth = 2.6 }: { size?: number; strokeWidth?: number }) => <Icon size={size} strokeWidth={strokeWidth}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>;
export const Heart = ({ size, filled }: { size?: number; filled?: boolean }) =>
  <Icon size={size} fill={filled ? "currentColor" : "none"}><path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" /></Icon>;
export const Bookmark = ({ size, filled }: { size?: number; filled?: boolean }) =>
  <Icon size={size} fill={filled ? "currentColor" : "none"}><path d="M6 3h12v18l-6-4-6 4z" /></Icon>;
export const Refresh = ({ size }: { size?: number }) => <Icon size={size}><path d="M20 11a8 8 0 00-14.5-4M4 5v4h4M4 13a8 8 0 0014.5 4M20 19v-4h-4" /></Icon>;
export const Search = ({ size }: { size?: number }) => <Icon size={size}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></Icon>;
export const Home = ({ size }: { size?: number }) => <Icon size={size}><path d="M4 11l8-7 8 7v9H4z" /></Icon>;
export const Library = ({ size }: { size?: number }) => <Icon size={size}><path d="M5 4h4v16H5zM10 4h4v16h-4zM15.5 5.5l3.8-1 3 14.6-3.8 1z" /></Icon>;
export const PlusCircle = ({ size }: { size?: number }) => <Icon size={size}><circle cx="12" cy="12" r="8.5" /><path d="M12 8v8M8 12h8" /></Icon>;
export const Settings = ({ size }: { size?: number }) => <Icon size={size}><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></Icon>;
export const BookOpen = ({ size }: { size?: number }) => <Icon size={size}><path d="M4 5h6a3 3 0 013 3v11a2 2 0 00-2-2H4zM20 5h-6a3 3 0 00-3 3v11a2 2 0 012-2h7z" /></Icon>;

export function Star({ filled, size = 40 }: { filled: boolean; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "var(--star)" : "none"} stroke={filled ? "var(--star)" : "var(--faint)"}
    strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.6 6.2 20.7l1.1-6.5L2.6 9.6l6.5-.9z" />
  </svg>;
}
