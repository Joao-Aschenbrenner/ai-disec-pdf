import { defineConfig } from "vitest/config";
import os from "os";
import path from "path";

// Never let the test suite modify a developer's real settings, runtime-model
// state, OCR logs, or confirmed-learning store under ~/.ai-disec-pdf.
process.env.AI_DISEC_DATA_DIR = path.join(os.tmpdir(), `ai-disec-pdf-vitest-${process.pid}`);

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
