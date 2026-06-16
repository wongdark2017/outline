import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react-oxc";
import browserslistToEsbuild from "browserslist-to-esbuild";
import webpackStats from "rollup-plugin-webpack-stats";
import type { ServerOptions } from "vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import environment from "./server/utils/environment";

let httpsConfig: ServerOptions["https"] | undefined;
let host: string | undefined;

// 在开发环境中配置 HTTPS 和主机名
if (environment.NODE_ENV === "development") {
  host = host = new URL(environment.URL!).hostname;

  try {
    // 尝试加载本地 SSL 证书以启用 HTTPS
    httpsConfig = {
      key: fs.readFileSync("./server/config/certs/private.key"),
      cert: fs.readFileSync("./server/config/certs/public.cert"),
    };
  } catch (_err) {
    // oxlint-disable-next-line no-console
    console.warn("No local SSL certs found, HTTPS will not be available");
  }
}

export default () =>
  defineConfig({
    root: "./",
    publicDir: "./static",
    // CDN URL 前缀，用于静态资源
    base: (environment.CDN_URL ?? "") + "/static/",
    server: {
      port: 3001,
      strictPort: true,
      host: true,
      https: httpsConfig,
      allowedHosts: host ? [host] : undefined,
      cors: true,
      proxy: {
      },
      fs:
        environment.NODE_ENV === "development"
          ? {
              // 允许从项目根目录的上一级提供文件
              allow: [".."],
            }
          : { strict: true },
    },
    plugins: [
      react(),
      // PWA 插件配置，用于生成 Service Worker 和 manifest
      // https://vite-pwa-org.netlify.app/
      VitePWA({
        injectRegister: "inline",
        registerType: "autoUpdate",
        workbox: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ["**/*.{js,css,ico,png,svg}"],
          navigateFallback: null,
          modifyURLPrefix: {
            "": `${environment.CDN_URL ?? ""}/static/`,
          },
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              // 缓存 URL 预览数据（仅使用缓存，不发起网络请求）
              urlPattern: /api\/urls\.unfurl$/,
              handler: "CacheOnly",
              options: {
                cacheName: "unfurl-cache",
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        manifest: {
          name: "Outline",
          short_name: "Outline",
          theme_color: "#fff",
          background_color: "#fff",
          start_url: "/",
          scope: ".",
          display: "standalone",
          // Chrome 要求至少提供 192x192 和 512x512 像素的图标。
          // 如果只提供这两个尺寸，Chrome 会自动缩放图标以适应设备。
          // 如果希望自行缩放图标以达到像素完美，请以 48dp 的增量提供图标。
          icons: [
            {
              src: "/images/icon-192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "/images/icon-512.png",
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: "/images/icon-maskable-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "/images/icon-maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "/images/icon-maskable-1024.png",
              sizes: "1024x1024",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "/images/icon-monochrome-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "monochrome",
            },
            {
              src: "/images/icon-monochrome-1024.png",
              sizes: "1024x1024",
              type: "image/png",
              purpose: "monochrome",
            },
          ],
        },
      }),
      // 生成 stats.json 文件供 RelativeCI 使用
      webpackStats(),
    ],
    experimental: {
      enableNativePlugin: true,
    },
    resolve: {
      // 路径别名配置
      alias: {
        "~": path.resolve(__dirname, "./app"),
        "@shared": path.resolve(__dirname, "./shared"),
      },
    },
    build: {
      outDir: "./build/app",
      manifest: true,
      sourcemap: process.env.CI ? false : "hidden",
      minify: "oxc",
      // 防止资源内联，因为它不符合 CSP 规则
      assetsInlineLimit: 0,
      target: browserslistToEsbuild(),
      reportCompressedSize: false,
      rollupOptions: {
        onwarn(warning, warn) {
          // 抑制关于模块级指令的警告，例如 "use client"
          if (warning.code === "MODULE_LEVEL_DIRECTIVE") {
            return;
          }
          warn(warning);
        },
        input: {
          index: "./app/index.tsx",
        },
        output: {
          assetFileNames: "assets/[name].[hash][extname]",
          chunkFileNames: "assets/[name].[hash].js",
          entryFileNames: "assets/[name].[hash].js",
          advancedChunks: {
            groups: [
              // 应用中使用的共享工具 — 更高的优先级
              // 防止它们被吸收到懒加载的 vendor 块中
              {
                name: "vendor-shared",
                test: /node_modules[\\/]uuid|vite[\\/]preload-helper/,
                priority: 30,
              },
              {
                name: "vendor-react",
                test: /node_modules[\\/](react|react-dom|scheduler|react-router)/,
                priority: 20,
              },
              {
                name: "vendor-prosemirror",
                test: /node_modules[\\/](@benrbray[\\/])?prosemirror/,
                priority: 20,
              },
              {
                name: "vendor-collab",
                test: /node_modules[\\/](yjs|y-prosemirror|y-indexeddb|@hocuspocus|lib0)/,
                priority: 20,
              },
              {
                name: "vendor-framer-motion",
                test: /node_modules[\\/]framer-motion/,
                priority: 20,
              },
              {
                name: "vendor-styled",
                test: /node_modules[\\/]styled-components/,
                priority: 20,
              },
              {
                name: "vendor-mermaid-elk",
                test: /node_modules[\\/](@mermaid-js[\\/]layout-elk|elkjs)/,
                priority: 25,
              },
              {
                name: "vendor-mermaid",
                test: /node_modules[\\/](mermaid|cytoscape|cytoscape-fcose|layout-base|dagre-d3-es|langium|chevrotain|roughjs|@mermaid-js)/,
                priority: 20,
              },
              {
                name: "vendor-katex",
                test: /node_modules[\\/]katex/,
                priority: 20,
              },
              {
                name: "vendor-emoji",
                test: /node_modules[\\/](@emoji-mart|emoji-mart)/,
                priority: 20,
              },
              {
                name: "vendor-es-toolkit",
                test: /node_modules[\\/]es-toolkit/,
                priority: 20,
              },
              {
                name: "vendor-date",
                test: /node_modules[\\/]date-fns/,
                priority: 20,
              },
              {
                name: "vendor-sentry",
                test: /node_modules[\\/]@sentry/,
                priority: 20,
              },
            ],
          },
        },
      },
    },
  });
