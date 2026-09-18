import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/** Include lazy lesson/lab chunks and workers, not only scripts visible in index.html. */
export const offlineBundle = (): Plugin => {
  let publicDir = "";
  const publicFiles = (root: string, prefix = ""): string[] => readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix + entry.name;
    return entry.isDirectory() ? publicFiles(path.join(root, entry.name), relative + "/") : entry.isFile() && relative !== "sw.js" ? [relative] : [];
  });
  return {
    name: "rivercraft-offline-bundle", apply: "build",
    configResolved(config) { publicDir = config.publicDir; },
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter(name => /\.(js|css|woff2?|svg|png|webp|jpg)$/.test(name));
      const assets = [...new Set([...built, ...publicFiles(publicDir)])].sort();
      const digest = createHash("sha256");
      for (const name of assets) {
        digest.update(name);
        if (!bundle[name]) digest.update(readFileSync(path.join(publicDir, name)));
      }
      const source = readFileSync(path.join(publicDir, "sw.js"), "utf8");
      digest.update(source);
      this.emitFile({ type: "asset", fileName: "offline-assets.json", source: JSON.stringify({ version: 1, assets }) });
      this.emitFile({ type: "asset", fileName: "sw.js", source: source.replace("__BUILD_ID__", digest.digest("hex").slice(0, 16)) });
    },
  };
};
