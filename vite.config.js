import { join, dirname } from "path";
import { fileURLToPath } from "url";

import viteReact from "@vitejs/plugin-react";

const path = fileURLToPath(import.meta.url);

export default {
  base: '/openai-realtime-push-to-talk/',
  root: join(dirname(path), "client"),
  plugins: [viteReact()],
};
