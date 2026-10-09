import qrcode from "qrcode-generator";

/** QR code en SVG (aucune requête réseau). Fond clair fixe : un QR doit rester lisible en thème sombre. */
export function QrCode({ value, size = 220 }: { value: string; size?: number }) {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  return <div className="qr-code" style={{ width: size, height: size }} role="img" aria-label="QR code de la clé de synchronisation"
    dangerouslySetInnerHTML={{ __html: svg }} />;
}
