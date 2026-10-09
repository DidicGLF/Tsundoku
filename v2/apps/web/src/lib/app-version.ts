/** Version de cette application (tag git du build). « dev » si le code tourne sans passer par le build. */
export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

/** Comparaison de versions X.Y.Z : positif si `a` est plus récente que `b`. Les suffixes (-dev.7, -beta) sont ignorés. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => version.replace(/^v/, "").split(/[-+]/)[0].split(".").map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    const delta = (x[i] || 0) - (y[i] || 0);
    if (delta) return delta;
  }
  return 0;
}
