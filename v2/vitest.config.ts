import { configDefaults, defineConfig } from "vitest/config";

// Les tests « live » interrogent les vrais services : ils se lancent à la main (pnpm test:live).
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify("0.0.0-test") },
  test: { exclude: [...configDefaults.exclude, "**/test/live/**"] }
});
