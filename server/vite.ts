import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({
        "Content-Type": "text/html",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");
  console.log(`[serveStatic] Looking for build directory at: ${distPath}`);
  console.log(`[serveStatic] import.meta.dirname: ${import.meta.dirname}`);
  console.log(`[serveStatic] Directory exists: ${fs.existsSync(distPath)}`);

  if (!fs.existsSync(distPath)) {
    const altPath = path.resolve(process.cwd(), "dist", "public");
    console.log(`[serveStatic] Trying alternative path: ${altPath}`);
    console.log(`[serveStatic] Alt directory exists: ${fs.existsSync(altPath)}`);
    
    if (fs.existsSync(altPath)) {
      console.log(`[serveStatic] Using alternative path: ${altPath}`);
      app.use(express.static(altPath));
      app.use("*", (_req, res) => {
        res.sendFile(path.resolve(altPath, "index.html"));
      });
      return;
    }

    console.error(`[serveStatic] Could not find build directory at ${distPath} or ${altPath}`);
    console.error(`[serveStatic] CWD: ${process.cwd()}`);
    try {
      console.error(`[serveStatic] CWD contents: ${fs.readdirSync(process.cwd()).join(', ')}`);
      const distDir = path.resolve(process.cwd(), "dist");
      if (fs.existsSync(distDir)) {
        console.error(`[serveStatic] dist/ contents: ${fs.readdirSync(distDir).join(', ')}`);
      }
    } catch (e) {}
    
    app.use("*", (_req, res) => {
      res.status(503).json({ error: "Frontend build not found", path: distPath });
    });
    return;
  }

  app.use(express.static(distPath));

  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
