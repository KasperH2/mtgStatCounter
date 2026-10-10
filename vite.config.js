import { defineConfig } from "vite";

// Relative asset paths, so the build works at https://kasperh2.github.io/mtgStatCounter/ as well as at a domain root.
export default defineConfig({
  base: "./"
});
