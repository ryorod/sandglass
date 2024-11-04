import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { glslify } from "vite-plugin-glslify";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    glslify({
      extensions: [/\.vert$/, /\.frag$/, /\.glsl$/, /\.vs$/, /\.fs$/],
      include: [/\.ts$/, /\.js$/, /\.tsx$/, /\.jsx$/],
    }),
  ],
});
