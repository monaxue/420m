// esbuild.config.mjs
import { build, context } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

const isWatch = process.argv.includes("--watch");

const banner = `/*
  Obsidian Custom Mentions
  Built: ${new Date().toISOString()}
*/`;

const opts = {
  entryPoints: ["main.ts"],
  outfile: "main.js",
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: ["es2020"],
  banner: { js: banner },
  external: ["obsidian"], // provided by Obsidian at runtime
  minify: !isWatch,
  sourcemap: isWatch,
  logLevel: "info",
};

async function ensureManifestMainJS() {
  const manifestPath = "manifest.json";
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.main !== "main.js") {
    manifest.main = "main.js";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
}

async function run() {
  await ensureManifestMainJS();

  if (isWatch) {
    const ctx = await context(opts);
    await ctx.watch();
    console.log("esbuild: watching… (Ctrl+C to stop)");
  } else {
    await build(opts);
    console.log("esbuild: build complete");
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
