import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';
import {defineConfig, searchForWorkspaceRoot} from 'vite';

export default defineConfig(() => {
  const projectRoot = path.resolve(__dirname, '.');
  // Managed worktrees may share node_modules through a junction. Vite resolves
  // that dependency to its real path, so explicitly allow only pdfjs-dist's
  // worker directory in addition to the workspace root.
  const pdfjsPackageRoot = fs.realpathSync(path.join(projectRoot, 'node_modules', 'pdfjs-dist'));
  return {
    plugins: [react(), tailwindcss()],
    optimizeDeps: {
      exclude: ["pdfjs-dist"],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      target: "esnext",
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      fs: {
        allow: [searchForWorkspaceRoot(projectRoot), pdfjsPackageRoot],
      },
    },
  };
});
