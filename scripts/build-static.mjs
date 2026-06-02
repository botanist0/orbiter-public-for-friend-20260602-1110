#!/usr/bin/env node
/**
 * Build script for static hosting (S3 + CloudFront or Azure Static Web Apps).
 * Copies app/* to dist/ and creates a _redirects file for SPA routing.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const appDir = path.join(rootDir, "app");
const distDir = path.join(rootDir, "dist");

console.log(`Building static assets from ${appDir} -> ${distDir}`);

// Create dist directory
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
}
fs.mkdirSync(distDir, { recursive: true });

// Copy browser assets needed for a detached static UI prototype.
const copyFileExtensions = [".html", ".css", ".js", ".json", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".ico", ".webp", ".woff", ".woff2"];

function copyDir(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (copyFileExtensions.includes(ext)) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

copyDir(appDir, distDir);

// Create _redirects for SPA routing (Netlify / Vercel format)
// This ensures all non-file requests go to index.html so React Router / client-side routing works
const redirectsContent = `/*    /index.html   200`;
fs.writeFileSync(path.join(distDir, "_redirects"), redirectsContent);

// Create .htaccess for Apache-based hosts (fallback)
const htaccessContent = `<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>`;
fs.writeFileSync(path.join(distDir, ".htaccess"), htaccessContent);

// Create web.config for Azure Static Web Apps / IIS
const webConfigContent = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="SPA">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>`;
fs.writeFileSync(path.join(distDir, "web.config"), webConfigContent);

// Print file tree
console.log("\nBuilt files:");
function printTree(dir, prefix = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? "`-- " : "|-- ";
    const nextPrefix = prefix + (isLast ? "    " : "|   ");
    console.log(prefix + connector + entry.name);
    if (entry.isDirectory()) {
      printTree(path.join(dir, entry.name), nextPrefix);
    }
  }
}
printTree(distDir);

console.log(`\nStatic build complete. Artifacts in ${distDir}`);
console.log("\nSPA routing files created:");
console.log("  - _redirects (Netlify/Vercel)");
console.log("  - .htaccess (Apache)");
console.log("  - web.config (Azure Static Web Apps / IIS)");
console.log("\nReady to deploy to CDN prototype.");
