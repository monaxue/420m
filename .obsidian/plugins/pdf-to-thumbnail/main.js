"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PdfCoverPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var PDFJS_VERSION = "4.7.76";
var pdfjsReady = null;
function tryLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}
async function loadPdfjsNoWorker() {
  if (pdfjsReady) return pdfjsReady;
  const candidates = [
    // cdnjs
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`,
    // jsDelivr
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`,
    // unpkg
    `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`
  ];
  pdfjsReady = (async () => {
    if (window.pdfjsLib) return window.pdfjsLib;
    let lastErr = null;
    for (const url of candidates) {
      try {
        await tryLoadScript(url);
        if (window.pdfjsLib) {
          console.log("[pdf-thumb] PDF.js loaded:", url);
          return window.pdfjsLib;
        }
      } catch (e) {
        console.warn("[pdf-thumb] Loader fallback failed:", e);
        lastErr = e;
      }
    }
    throw lastErr != null ? lastErr : new Error("Unable to load PDF.js from any CDN");
  })();
  return pdfjsReady;
}
var DEFAULT_SETTINGS = {
  frontmatterKey: "cover",
  outputDir: "_pdf-covers",
  scale: 2,
  overwriteImage: true
};
var FolderSuggestModal = class extends import_obsidian.FuzzySuggestModal {
  constructor(app_, onChoose) {
    super(app_);
    this.app_ = app_;
    this.onChoose = onChoose;
    this.setPlaceholder("Start typing to search folders\u2026");
  }
  getItems() {
    const all = this.app_.vault.getAllLoadedFiles();
    const folders = [];
    for (const af of all) if (af instanceof import_obsidian.TFolder) folders.push(af);
    return folders.sort((a, b) => a.path.localeCompare(b.path));
  }
  getItemText(item) {
    return item.path || "/";
  }
  onChooseItem(item) {
    this.onChoose(item);
  }
};
var PdfCoverPlugin = class extends import_obsidian.Plugin {
  async onload() {
    console.log("Loading PDF to Thumbnail plugin\u2026");
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new PdfCoverSettingTab(this.app, this));
    this.addCommand({
      id: "generate-pdf-thumbnail-from-linked-pdf",
      name: "Generate thumbnail from first linked PDF (current note)",
      callback: async () => {
        const mdView = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
        if (!mdView || !mdView.file) {
          new import_obsidian.Notice("Open a Markdown note and try again.");
          console.warn("[pdf-thumb] No active MarkdownView.");
          return;
        }
        const pdfFile = this.findFirstLinkedPdf(mdView.file);
        if (!pdfFile) {
          new import_obsidian.Notice("No linked PDF found in this note. Try the 'Pick a PDF\u2026' command.");
          console.warn("[pdf-thumb] No linked PDF found in note:", mdView.file.path);
          return;
        }
        new import_obsidian.Notice(`Rendering: ${pdfFile.name}`);
        await this.generateCoverForPdf(pdfFile, mdView.file);
      }
    });
    this.addCommand({
      id: "pick-pdf-and-generate-thumbnail",
      name: "Pick a PDF in vault and generate thumbnail (updates active note)",
      callback: async () => {
        const pdf = await this.pickPdfFromVault();
        if (!pdf) return;
        await this.generateCoverForPdf(pdf);
      }
    });
    this.addCommand({
      id: "bulk-generate-thumbnails-for-folder",
      name: "Bulk: generate thumbnails for notes in a folder",
      callback: async () => {
        new FolderSuggestModal(this.app, async (folder) => {
          await this.bulkProcessFolder(folder);
        }).open();
      }
    });
    this.addCommand({
      id: "pdf-thumb-debug-info",
      name: "Debug: show PDF to Thumbnail info",
      callback: () => {
        var _a, _b;
        const mdView = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
        const filePath = (_b = (_a = mdView == null ? void 0 : mdView.file) == null ? void 0 : _a.path) != null ? _b : "(none)";
        console.log("[pdf-thumb] Debug info", {
          activeFile: filePath,
          settings: this.settings
        });
        new import_obsidian.Notice(
          `Debug:
Active file: ${filePath}
Output: ${this.settings.outputDir}
Key: ${this.settings.frontmatterKey}`
        );
      }
    });
  }
  onunload() {
    console.log("Unloading PDF to Thumbnail plugin.");
  }
  /** =================
   * Core render flow
   * ================= */
  async generateCoverForPdf(pdfFile, noteToUpdate) {
    var _a;
    try {
      const pdfjsLib = await loadPdfjsNoWorker();
      const arrayBuffer = await this.app.vault.readBinary(pdfFile);
      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
        disableWorker: true,
        // render in main thread (no worker needed)
        useSystemFonts: true,
        useWorkerFetch: false
      });
      const pdf = await loadingTask.promise;
      if (pdf.numPages < 1) {
        new import_obsidian.Notice(`PDF has no pages: ${pdfFile.path}`);
        return;
      }
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: this.settings.scale });
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        new import_obsidian.Notice("Failed to get 2D canvas context.");
        return;
      }
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const pngBytes = await this.canvasToPngBytes(canvas);
      const dir = this.settings.outputDir.replace(/\/+$/, "");
      await this.ensureFolder(dir);
      const baseName = pdfFile.basename.replace(/\s+/g, "_");
      const outPath = `${dir}/${baseName}.png`;
      const existing = this.app.vault.getAbstractFileByPath(outPath);
      if (existing instanceof import_obsidian.TFile) {
        if (!this.settings.overwriteImage) {
        } else {
          await this.app.vault.modifyBinary(existing, pngBytes);
          console.log(`[pdf-thumb] updated: ${outPath}`);
        }
      } else {
        await this.app.vault.createBinary(outPath, pngBytes);
        console.log(`[pdf-thumb] created: ${outPath}`);
      }
      const targetNote = noteToUpdate != null ? noteToUpdate : (_a = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView)) == null ? void 0 : _a.file;
      if (targetNote) {
        await this.writeFrontmatterImage(targetNote, outPath);
      }
    } catch (e) {
      console.error(e);
      new import_obsidian.Notice(`Failed to generate thumbnail from: ${pdfFile.path}. See console.`);
    }
  }
  async writeFrontmatterImage(note, imagePath) {
    const key = this.settings.frontmatterKey.trim();
    if (!key) return;
    await this.app.fileManager.processFrontMatter(note, (fm) => {
      fm[key] = imagePath;
    });
    console.log(`[pdf-thumb] ${note.path} \u2192 ${key}: ${imagePath}`);
  }
  async canvasToPngBytes(canvas) {
    const blobOrNull = await new Promise(
      (resolve) => canvas.toBlob((b) => resolve(b), "image/png")
    );
    const blob = blobOrNull != null ? blobOrNull : await (async () => {
      const dataUrl = canvas.toDataURL("image/png");
      const res = await fetch(dataUrl);
      return await res.blob();
    })();
    return await blob.arrayBuffer();
  }
  /** ============================
   * Link detection + resolution
   * ============================ */
  findFirstLinkedPdf(note) {
    const cache = this.app.metadataCache.getFileCache(note);
    const rawCandidates = [];
    if (cache == null ? void 0 : cache.links) {
      for (const l of cache.links) if (l.link) rawCandidates.push(l.link);
    }
    if (cache == null ? void 0 : cache.embeds) {
      for (const e of cache.embeds) if (e.link) rawCandidates.push(e.link);
    }
    const normalize = (s) => s.trim().replace(/\|.*$/, "").replace(/#.*$/, "");
    for (const raw of rawCandidates) {
      const link = normalize(raw);
      if (!link.toLowerCase().endsWith(".pdf")) continue;
      const target = this.app.metadataCache.getFirstLinkpathDest(link, note.path);
      if (target instanceof import_obsidian.TFile && target.extension.toLowerCase() === "pdf") {
        return target;
      }
    }
    console.warn("[pdf-thumb] No PDF match. Candidates:", rawCandidates, "note:", note.path);
    return null;
  }
  /** =================
   * Misc helpers
   * ================= */
  async pickPdfFromVault() {
    const all = this.app.vault.getFiles().filter((f) => f.extension.toLowerCase() === "pdf");
    if (all.length === 0) {
      new import_obsidian.Notice("No PDFs in vault.");
      return null;
    }
    const name = prompt(
      "Type (exact) filename/path to use:\n" + all.slice(0, 200).map((f) => f.path).join("\n")
    );
    if (!name) return null;
    const hit = all.find(
      (f) => f.path === name || f.basename === name || f.name === name
    );
    if (!hit) new import_obsidian.Notice("No matching PDF found.");
    return hit != null ? hit : null;
  }
  async ensureFolder(path) {
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      const af = this.app.vault.getAbstractFileByPath(cur);
      if (!af) await this.app.vault.createFolder(cur);
    }
  }
  /** =========================
   * Bulk folder processing
   * ========================= */
  async bulkProcessFolder(folder) {
    const mdFiles = this.collectMarkdownFiles(folder);
    if (mdFiles.length === 0) {
      new import_obsidian.Notice(`No Markdown notes in: ${folder.path}`);
      return;
    }
    let updated = 0;
    let skippedNoPdf = 0;
    try {
      await loadPdfjsNoWorker();
    } catch (e) {
      console.error("[pdf-thumb] Failed to load PDF.js for bulk run:", e);
      new import_obsidian.Notice("Failed to load PDF.js for bulk run. See console.");
      return;
    }
    for (const note of mdFiles) {
      try {
        const pdf = this.findFirstLinkedPdf(note);
        if (!pdf) {
          skippedNoPdf++;
          continue;
        }
        await this.generateCoverForPdf(pdf, note);
        updated++;
      } catch (err) {
        console.error(`[pdf-thumb] Error on ${note.path}:`, err);
      }
    }
    new import_obsidian.Notice(
      `PDF thumbnails complete for "${folder.path}"
Notes scanned: ${mdFiles.length}
Updated: ${updated}
No linked PDF: ${skippedNoPdf}`
    );
  }
  collectMarkdownFiles(folder) {
    const out = [];
    const walk = (f) => {
      if (f instanceof import_obsidian.TFile) {
        if (f.extension.toLowerCase() === "md") out.push(f);
      } else if (f instanceof import_obsidian.TFolder) {
        for (const child of f.children) walk(child);
      }
    };
    walk(folder);
    out.sort((a, b) => a.path.localeCompare(b.path));
    return out;
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var PdfCoverSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "PDF to Thumbnail" });
    new import_obsidian.Setting(containerEl).setName("Frontmatter key").setDesc("YAML field to write the thumbnail image path to.").addText(
      (t) => t.setPlaceholder("cover").setValue(this.plugin.settings.frontmatterKey).onChange(async (v) => {
        this.plugin.settings.frontmatterKey = v || "cover";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Output folder").setDesc("Where to save generated PNGs (relative to vault root).").addText(
      (t) => t.setPlaceholder("_pdf-covers").setValue(this.plugin.settings.outputDir).onChange(async (v) => {
        this.plugin.settings.outputDir = v || "_pdf-covers";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Render scale").setDesc("Higher = larger image; 2 is usually good.").addSlider(
      (s) => s.setLimits(1, 4, 1).setValue(this.plugin.settings.scale).onChange(async (v) => {
        this.plugin.settings.scale = v;
        await this.plugin.saveSettings();
      }).setDynamicTooltip()
    );
    new import_obsidian.Setting(containerEl).setName("Overwrite existing images").setDesc("If off, existing PNGs will not be replaced.").addToggle(
      (t) => t.setValue(this.plugin.settings.overwriteImage).onChange(async (v) => {
        this.plugin.settings.overwriteImage = v;
        await this.plugin.saveSettings();
      })
    );
  }
};
