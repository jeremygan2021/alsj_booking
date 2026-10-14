import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Evidence assets are served through authenticated /api/models routes only.
export default defineConfig({
  plugins: [
    react(),
    {
      name: "public-wall-ar-assets",
      closeBundle() {
        const root = fileURLToPath(new URL("./", import.meta.url));
        mkdirSync(root + "dist", { recursive: true });
        for (const asset of [
          "ar-assets",
          "ar-target.html",
          "favicon.svg",
          "invitation",
        ])
          if (existsSync(root + "public/" + asset))
            cpSync(root + "public/" + asset, root + "dist/" + asset, {
              recursive: true,
            });
      },
    },
  ],
  publicDir: false,
  server: {
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        "**/public/models/**",
        "**/server/**",
        "**/交付包_*/**",
      ],
    },
  },
});
