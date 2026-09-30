import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60000,
    // Testes de runtime de modelos (rotação/refresh) usam servers reais em
    // portas distintas, mas compartilham ~/.ai-disec-pdf/settings.json e o
    // estado global do módulo. Execução sequencial evita disputa de arquivo.
    fileParallelism: false,
  },
});