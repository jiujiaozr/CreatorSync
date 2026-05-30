import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const normalizeBasePath = (value?: string) => {
  if (!value || value === "/") {
    return "/";
  }

  return value.endsWith("/") ? value : `${value}/`;
};

export default defineConfig(() => ({
  base: normalizeBasePath(process.env.VITE_BASE_PATH),
  plugins: [react()],
}));
