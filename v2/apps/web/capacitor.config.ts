import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "fr.tsundoku.app",
  appName: "Tsundoku",
  webDir: "dist",
  // Le journal verbeux du pont natif écrit chaque requête SQL (et le contenu du stockage
  // sécurisé, clé Google comprise) dans logcat, et ralentit chaque appel.
  loggingBehavior: "none"
};

export default config;
