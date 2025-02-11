import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";

import { defineConfig } from 'vite'
import tailwindcssVite from '@tailwindcss/vite'
import viteReact from "@vitejs/plugin-react";

const path = fileURLToPath(import.meta.url);

export default defineConfig({
  base: '/openai-realtime-push-to-talk/',
  root: join(dirname(path), "client"),
  plugins: [
    tailwindcssVite(),
    viteReact(),
  ],
});
