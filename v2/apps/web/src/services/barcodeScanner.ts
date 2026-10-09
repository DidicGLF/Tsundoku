import { Capacitor } from "@capacitor/core";
import { BarcodeFormat, BarcodeScanner, GoogleBarcodeScannerModuleInstallState } from "@capacitor-mlkit/barcode-scanning";
import { isbnFromBarcode } from "../lib/barcode";

/** Le lecteur de Google passe par la caméra du téléphone : il n'existe que dans l'application Android. */
export const canScanBarcode = () => Capacitor.isNativePlatform();

/** Le lecteur est un module de Google Play Services, téléchargé une fois (quelques secondes). */
async function ensureScannerModule(): Promise<void> {
  if ((await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()).available) return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => done(new Error("Le lecteur de codes-barres met trop de temps à s'installer.")), 90000);
    let handle: { remove: () => Promise<void> } | undefined;
    function done(error?: Error) {
      window.clearTimeout(timer);
      void handle?.remove();
      error ? reject(error) : resolve();
    }
    void BarcodeScanner.addListener("googleBarcodeScannerModuleInstallProgress", event => {
      if (event.state === GoogleBarcodeScannerModuleInstallState.COMPLETED) done();
      else if (event.state === GoogleBarcodeScannerModuleInstallState.FAILED || event.state === GoogleBarcodeScannerModuleInstallState.CANCELED)
        done(new Error("Le lecteur de codes-barres n'a pas pu être installé (Google Play Services requis)."));
    }).then(listener => { handle = listener; });
    BarcodeScanner.installGoogleBarcodeScannerModule().catch(error => done(error instanceof Error ? error : new Error(String(error))));
  });
}

/** Ouvre le lecteur et renvoie le texte du premier code lu (`null` : scan annulé). */
async function scanFirst(formats: BarcodeFormat[]): Promise<string | null> {
  await ensureScannerModule();
  try {
    const { barcodes } = await BarcodeScanner.scan({ formats });
    return barcodes[0]?.rawValue ?? null;
  } catch (error) {
    if (/cancel/i.test(String((error as Error)?.message))) return null;
    throw error;
  }
}

/**
 * Renvoie l'ISBN-13 du code-barres visé.
 * `null` : scan annulé. Erreur : lecteur indisponible, ou code qui n'est pas un ISBN.
 */
export async function scanIsbn(): Promise<string | null> {
  const raw = await scanFirst([BarcodeFormat.Ean13]);
  if (raw === null) return null;
  const isbn = isbnFromBarcode(raw);
  if (!isbn) throw new Error("Ce code-barres n'est pas celui d'un livre (il doit commencer par 978 ou 979).");
  return isbn;
}

/** Lit un QR code et renvoie son texte (`null` : scan annulé). */
export function scanQrText(): Promise<string | null> {
  return scanFirst([BarcodeFormat.QrCode]);
}
