import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    // NÃO injetar segredos aqui: tudo que entra em `define` vai literalmente
    // para o bundle e fica legível para qualquer visitante. As chamadas de IA
    // passam por /api/ai/* no servidor (ver ai-routes.ts).
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          // Separa bibliotecas pesadas em chunks próprios (carregam só quando usadas).
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
            'vendor-charts': ['recharts'],
            'vendor-xlsx': ['xlsx'],
            'vendor-pdf': ['jspdf', 'jspdf-autotable'],
            'vendor-motion': ['motion'],
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'react': path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
