import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    rollupOptions: {
      output: {
        // three.js dominates the bundle; splitting it lets the shell load
        // before the 3D viewer chunk (rolldown requires the function form)
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    fs: {
      // node_modules is symlinked to the parent checkout in worktree setups;
      // the resolved real path must be inside the allow list or assets 403
      allow: ['.', '/Users/ashwin/scan-diff/node_modules'],
    },
  },
});
