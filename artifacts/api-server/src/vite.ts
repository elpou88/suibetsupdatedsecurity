import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { type Server } from "http";

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(_app: Express, _server: Server) {
  log("API-only mode: frontend served separately via suibets artifact");
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    log(`No static build found at ${distPath} — API-only mode`);
    app.use("/{*splat}", (_req, res) => {
      res.status(404).json({ error: "Static frontend not found — use the suibets app" });
    });
    return;
  }

  app.use(express.static(distPath));
  app.use("/{*splat}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
