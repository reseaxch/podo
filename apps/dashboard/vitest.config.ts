import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.vitest.{ts,tsx}"],
  },
})
