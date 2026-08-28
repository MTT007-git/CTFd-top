#!/usr/bin/env node
/**
 * Builds the extension into two directories:
 *   dist/          Chrome  (manifest.json)
 *   dist-firefox/  Firefox (manifest.firefox.json renamed to manifest.json)
 *
 * Flags: --watch, --clean
 *
 * If esbuild is not installed but dist/ already contains prebuilt JS, the static
 * assets are copied anyway and the bundling step is skipped with a notice.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHROME_DIR = path.join(ROOT, "dist");
const FIREFOX_DIR = path.join(ROOT, "dist-firefox");

/** output name -> entry point */
const ENTRIES = {
  "background.js": "src/background.ts",
  "content.js": "src/content.ts",
  "popup.js": "src/popup/popup.ts",
};

/** source -> name in both output directories */
const STATIC_FILES = [
  ["src/popup/popup.html", "popup.html"],
  ["src/popup/popup.css", "popup.css"],
  ["src/css/badges.css", "badges.css"],
  ["src/icons/icon16.png", "icons/icon16.png"],
  ["src/icons/icon32.png", "icons/icon32.png"],
  ["src/icons/icon48.png", "icons/icon48.png"],
  ["src/icons/icon128.png", "icons/icon128.png"],
];

/** Each browser gets its own manifest under the same name. */
const MANIFESTS = [
  [CHROME_DIR, "manifest.json"],
  [FIREFOX_DIR, "manifest.firefox.json"],
];

const argv = new Set(process.argv.slice(2));
const watch = argv.has("--watch");
const clean = argv.has("--clean");

async function ensureDirs() {
  await mkdir(CHROME_DIR, { recursive: true });
  await mkdir(FIREFOX_DIR, { recursive: true });
  await mkdir(path.join(CHROME_DIR, "icons"), { recursive: true });
  await mkdir(path.join(FIREFOX_DIR, "icons"), { recursive: true });
}

async function copyStatic() {
  await ensureDirs();
  for (const [source, name] of STATIC_FILES) {
    const from = path.join(ROOT, source);
    for (const dir of [CHROME_DIR, FIREFOX_DIR]) {
      await copyFile(from, path.join(dir, name));
    }
  }
  for (const [dir, manifest] of MANIFESTS) {
    await copyFile(path.join(ROOT, manifest), path.join(dir, "manifest.json"));
  }
}

/** Firefox gets the same bundles as Chrome; only the manifest differs. */
async function mirrorScripts() {
  await ensureDirs();
  const names = (await readdir(CHROME_DIR)).filter((name) => name.endsWith(".js"));
  for (const name of names) {
    await copyFile(path.join(CHROME_DIR, name), path.join(FIREFOX_DIR, name));
  }
}

async function loadEsbuild() {
  try {
    return await import("esbuild");
  } catch {
    return null;
  }
}

function buildOptions(outName, entry) {
  return {
    entryPoints: [path.join(ROOT, entry)],
    outfile: path.join(CHROME_DIR, outName),
    bundle: true,
    format: "iife",
    target: "es2020",
    platform: "browser",
    legalComments: "none",
    logLevel: "info",
    plugins: [
      {
        name: "ctfd-top-mirror",
        setup(build) {
          // Keep dist-firefox/ and the static assets in step on every rebuild.
          build.onEnd(async (result) => {
            if (result.errors.length > 0) return;
            await copyStatic();
            await mirrorScripts();
          });
        },
      },
    ],
  };
}

async function main() {
  if (clean) {
    await rm(CHROME_DIR, { recursive: true, force: true });
    await rm(FIREFOX_DIR, { recursive: true, force: true });
    console.log("removed dist/ and dist-firefox/");
    return;
  }

  const esbuild = await loadEsbuild();

  if (!esbuild) {
    const prebuilt = Object.keys(ENTRIES).every((name) => existsSync(path.join(CHROME_DIR, name)));
    if (!prebuilt) {
      console.error(
        "error: esbuild is not installed and dist/ contains no prebuilt JavaScript.\n" +
          "       Run `npm install` (dev dependency: esbuild) and build again.",
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      "notice: esbuild is not installed — reusing the prebuilt JavaScript in dist/ and copying static assets only.",
    );
    await copyStatic();
    await mirrorScripts();
    return;
  }

  if (watch) {
    const contexts = [];
    for (const [outName, entry] of Object.entries(ENTRIES)) {
      const context = await esbuild.context(buildOptions(outName, entry));
      await context.watch();
      contexts.push(context);
    }
    console.log("watching for changes… (ctrl-c to stop)");
    const stop = async () => {
      await Promise.all(contexts.map((context) => context.dispose()));
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return;
  }

  for (const [outName, entry] of Object.entries(ENTRIES)) {
    await esbuild.build(buildOptions(outName, entry));
  }
  await copyStatic();
  await mirrorScripts();
  console.log("built dist/ (Chrome) and dist-firefox/ (Firefox)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
