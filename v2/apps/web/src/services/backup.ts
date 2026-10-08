import { Capacitor } from "@capacitor/core";
import { backupFileName, buildBackup, parseBackup, planImport } from "../lib/backup";
import type { ImportReport } from "../lib/backup";
import { applyImport, exportLibraryData, type LibraryBook } from "./library";

const LAST_BACKUP_KEY = "tsundoku.last-backup";
const NUDGE_DISMISSED_KEY = "tsundoku.backup-nudge-dismissed";
const DAY = 24 * 3600 * 1000;

function readTime(key: string): number | undefined {
  try { const value = Number(localStorage.getItem(key)); return value > 0 ? value : undefined; } catch { return undefined; }
}
function writeTime(key: string, value: number): void {
  try { localStorage.setItem(key, String(value)); } catch { /* facultatif */ }
}

export const lastBackupAt = () => readTime(LAST_BACKUP_KEY);
export const dismissBackupNudge = (now = Date.now()) => writeTime(NUDGE_DISMISSED_KEY, now);

/**
 * Rappel discret : une bibliothèque qui compte (≥ 5 livres) jamais sauvegardée, ou pas depuis 30 jours.
 * Après « Plus tard », on ne redemande pas avant 14 jours.
 */
export function shouldNudgeBackup(bookCount: number, now = Date.now(), last = lastBackupAt(), dismissed = readTime(NUDGE_DISMISSED_KEY)): boolean {
  if (bookCount < 5) return false;
  if (dismissed && now - dismissed < 14 * DAY) return false;
  return !last || now - last > 30 * DAY;
}

/** Remet le fichier à l'utilisateur : feuille de partage sur Android (Drive, messagerie…), téléchargement sur le web. */
async function deliver(json: string, name: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
    await Filesystem.writeFile({ path: name, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 });
    const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Cache });
    await Share.share({ title: "Sauvegarde Tsundoku", url: uri, dialogTitle: "Enregistrer ou envoyer la sauvegarde" });
    return;
  }
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportBackup(): Promise<{ count: number; name: string }> {
  const { library, followed } = await exportLibraryData();
  const backup = buildBackup(library, followed);
  const name = backupFileName();
  await deliver(JSON.stringify(backup), name);
  writeTime(LAST_BACKUP_KEY, Date.now());
  return { count: library.length, name };
}

export interface ImportPreview { added: number; merged: number; unchanged: number; apply: () => Promise<ImportReport & { library: LibraryBook[] }> }

/** Lit un fichier de sauvegarde et prépare l'import : le résumé s'affiche avant que rien ne soit modifié. */
export async function previewImport(file: File, current: LibraryBook[]): Promise<ImportPreview> {
  const backup = parseBackup(await file.text());
  const plan = planImport(backup, current);
  return { added: plan.add.length, merged: plan.merge.length, unchanged: plan.unchanged, apply: () => applyImport(plan, backup) };
}
