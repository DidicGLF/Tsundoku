import { configDefaults, defineConfig } from "vitest/config";

// Les tests « live » interrogent les vrais services : ils se lancent à la main (pnpm test:live).
export default defineConfig({ test: { exclude: [...configDefaults.exclude, "**/test/live/**"] } });
