import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {execSync} from 'child_process';

function getBuildInfo() {
  try {
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    // Versão: vYYYY-MM-DD-HHmm no fuso horário de Panambi (UTC-3)
    const now = new Date();
    const panambi = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const version = `v${panambi.getUTCFullYear()}-${String(panambi.getUTCMonth() + 1).padStart(2, '0')}-${String(panambi.getUTCDate()).padStart(2, '0')}-${String(panambi.getUTCHours()).padStart(2, '0')}${String(panambi.getUTCMinutes()).padStart(2, '0')}`;
    const timestamp = now.toISOString().slice(0, 19).replace('T', ' ');
    return { commit, version, timestamp };
  } catch {
    const now = new Date();
    const panambi = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const version = `v${panambi.getUTCFullYear()}-${String(panambi.getUTCMonth() + 1).padStart(2, '0')}-${String(panambi.getUTCDate()).padStart(2, '0')}-${String(panambi.getUTCHours()).padStart(2, '0')}${String(panambi.getUTCMinutes()).padStart(2, '0')}`;
    return { commit: 'unknown', version, timestamp: now.toISOString().slice(0, 19).replace('T', ' ') };
  }
}

const buildInfo = getBuildInfo();

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    define: {
      __BUILD_INFO__: JSON.stringify(buildInfo),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      allowedHosts: true as true,
    },
  };
});
