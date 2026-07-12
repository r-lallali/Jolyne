import path from "node:path";
import { defineConfig } from "vitest/config";

// Tests unitaires des libs pures (src/lib, src/stores). jsdom global :
// certaines libs touchent window/DOM (sanitize → DOMPurify). Les composants
// React ne sont pas encore couverts — ajouter @testing-library/react quand
// on s'y mettra.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
