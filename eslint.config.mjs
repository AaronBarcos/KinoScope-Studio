import { defineConfig } from "eslint/config";
import next from "eslint-config-next";

export default defineConfig([
  {
    ignores: ["dist/**/*", ".next/**", ".next-dev/**", "node_modules/**"],
  },
  {
    extends: [...next],
  },
]);
