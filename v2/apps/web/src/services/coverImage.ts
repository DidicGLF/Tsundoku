/** Taille maximale (côté le plus grand) d'une jaquette enregistrée : assez net, quelques dizaines de Ko. */
export const MAX_COVER_SIDE = 640;

/** Dimensions réduites pour tenir dans `max`, sans jamais agrandir. */
export function fitSize(width: number, height: number, max = MAX_COVER_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Lit une image (photo de l'appareil ou fichier), la réduit et la renvoie en JPEG `data:`. */
export async function fileToCoverDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Cette image ne peut pas être lue."));
      element.src = url;
    });
    const { width, height } = fitSize(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Impossible de traiter l'image sur cet appareil.");
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
