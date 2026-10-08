import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'read-later-offline-shell',
      apply: 'build',
      async generateBundle(_options, bundle) {
        const assets = Object.keys(bundle).map(name => '/' + name);
        const template = await readFile(new URL('./public/sw.js', import.meta.url), 'utf8');
        const version = createHash('sha256').update(template).update(assets.join('\n')).digest('hex').slice(0, 12);
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: template
            .replace("'__BUILD_CACHE__'", JSON.stringify('read-later-shell-' + version))
            .replace("'__BUILD_ASSETS__'", assets.map(name => JSON.stringify(name)).join(', ')),
        });
      },
    },
  ],
  css: { postcss: { plugins: [] } },
  build: { outDir: '../../web-dist', emptyOutDir: true },
});
