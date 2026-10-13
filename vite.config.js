import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Evidence assets are served through authenticated /api/models routes only.
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  server: {
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        "**/public/models/**",
      ],
    },
  },
});
