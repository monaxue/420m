import {
  App,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile
} from "obsidian";
import type { PluginSettings, TriggerConfig } from "./types";

type SuggestItem =
  | { kind: "page"; file: TFile; name: string; path: string }
  | { kind: "command"; id: string; name: string }
  | { kind: "tag"; tag: string; name: string };

export class MultiTriggerSuggest extends EditorSuggest<SuggestItem> {
  private settings: PluginSettings;
  private triggersBySymbol: Map<string, TriggerConfig>;
  private appRef: App;

  constructor(app: App, settings: PluginSettings) {
    super(app);
    this.appRef = app;
    this.settings = settings;
    this.triggersBySymbol = new Map(settings.triggers.map(t => [t.symbol, t]));
  }

  updateSettings(settings: PluginSettings) {
    this.settings = settings;
    this.triggersBySymbol = new Map(settings.triggers.map(t => [t.symbol, t]));
  }

  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    if (!file) return null;

    const line = editor.getLine(cursor.line);
    const upto = line.slice(0, cursor.ch);

    // find the last trigger symbol on this line
    let bestIndex = -1;
    let bestSymbol: string | null = null;
    for (const sym of this.triggersBySymbol.keys()) {
      const idx = upto.lastIndexOf(sym);
      if (idx >= 0 && idx > bestIndex) {
        bestIndex = idx;
        bestSymbol = sym;
      }
    }
    if (bestIndex < 0 || !bestSymbol) return null;

    const startCh = bestIndex;
    const start = { line: cursor.line, ch: startCh };
    const end = { line: cursor.line, ch: cursor.ch };
    const query = upto.slice(bestIndex + 1); // allow empty query to open

    return { start, end, query };
  }

  async getSuggestions(context: EditorSuggestContext) {
    const line = this.context?.editor.getLine(context.start.line) ?? "";
    const sym = line.charAt(context.start.ch);
    const trig = this.triggersBySymbol.get(sym);
    if (!trig) return [];

    const q = (context.query || "").trim();

    if (trig.source === "pages") return this.getPageSuggestions(q, trig);
    if (trig.source === "commands") return this.getCommandSuggestions(q, trig);
    return this.getTagSuggestions(q, trig);
  }

  renderSuggestion(value: SuggestItem, el: HTMLElement) {
    const row = el.createDiv({ cls: "cm-suggest-row" });
    if (value.kind === "page") {
      row.createDiv({ cls: "cm-suggest-title", text: value.name });
      row.createDiv({ cls: "cm-suggest-sub", text: value.path });
    } else if (value.kind === "command") {
      row.createDiv({ cls: "cm-suggest-title", text: value.name });
      row.createDiv({ cls: "cm-suggest-sub", text: value.id });
    } else {
      row.createDiv({ cls: "cm-suggest-title", text: value.tag });
      row.createDiv({ cls: "cm-suggest-sub", text: value.name });
    }
  }

  selectSuggestion(value: SuggestItem): void {
    const editor = this.context?.editor;
    if (!editor) return;

    // Identify trigger symbol (char at start)
    const sym = editor.getLine(this.context!.start.line).charAt(this.context!.start.ch);
    const trig = this.triggersBySymbol.get(sym);
    if (!trig) return;

    const text = this.buildInsertion(value, trig);

    if (trig.wrapPreviousWord) {
      this.wrapPrevWord(editor, text, trig);
      return;
    }

    editor.replaceRange(text.replace("{{cursor}}", ""), this.context!.start, this.context!.end);

    const cursorMarker = text.indexOf("{{cursor}}");
    if (cursorMarker >= 0) {
      const start = this.context!.start;
      const before = text.slice(0, cursorMarker);
      const lineOffset = (before.match(/\n/g)?.length ?? 0);
      const chOffset = (before.split("\n").pop() ?? "").length;
      editor.setCursor({ line: start.line + lineOffset, ch: (lineOffset ? 0 : start.ch) + chOffset });
    }

    if (trig.selectAfterInsert) {
      const start = this.context!.start;
      const end = {
        line: start.line + (text.match(/\n/g)?.length ?? 0),
        ch: (text.includes("\n") ? (text.split("\n").pop() ?? "").length : start.ch + text.length)
      };
      editor.setSelection(start, end);
    }
  }

  private buildInsertion(item: SuggestItem, trig: TriggerConfig): string {
    let tpl = trig.template ?? "{{display}}";

    if (item.kind === "page") {
      const link = `[[${item.name}]]`;
      tpl = tpl
        .replaceAll("{{link}}", link)
        .replaceAll("{{path}}", item.path)
        .replaceAll("{{name}}", item.name)
        .replaceAll("{{display}}", item.name);
    } else if (item.kind === "command") {
      tpl = tpl
        .replaceAll("{{id}}", item.id)
        .replaceAll("{{name}}", item.name)
        .replaceAll("{{display}}", item.name);
    } else {
      const bare = item.tag.startsWith("#") ? item.tag.substring(1) : item.tag;
      tpl = tpl
        .replaceAll("{{tag}}", item.tag)
        .replaceAll("{{name}}", bare)
        .replaceAll("{{display}}", item.tag);
    }

    return tpl;
  }

  private wrapPrevWord(editor: Editor, wrapped: string, trig: TriggerConfig) {
    const cursor = editor.getCursor();
    const lineText = editor.getLine(cursor.line);
    const left = lineText.slice(0, cursor.ch);
    const match = left.match(/([A-Za-z0-9_\-]+)$/);
    if (!match) {
      editor.replaceRange(wrapped.replace("{{cursor}}", ""), cursor);
      return;
    }
    const startCh = cursor.ch - match[0].length;
    const start = { line: cursor.line, ch: startCh };
    const end = { line: cursor.line, ch: cursor.ch };
    const text = wrapped.replace("{{cursor}}", "");
    editor.replaceRange(text, start, end);

    const cursorMarker = wrapped.indexOf("{{cursor}}");
    if (cursorMarker >= 0) {
      const before = wrapped.slice(0, cursorMarker);
      const lineOffset = (before.match(/\n/g)?.length ?? 0);
      const chOffset = (before.split("\n").pop() ?? "").length;
      editor.setCursor({ line: start.line + lineOffset, ch: (lineOffset ? 0 : start.ch) + chOffset });
    }
  }

  private async getPageSuggestions(q: string, trig: TriggerConfig) {
    const files = this.appRef.vault.getMarkdownFiles();
    const { includeFolders, excludeFolders, requireTags, excludeTags, filenameMatches } = trig.pageFilters ?? {};
    const meta = this.appRef.metadataCache;

    const norm = (s: string) => s.toLowerCase();

    const out: SuggestItem[] = [];
    for (const f of files) {
      if (includeFolders?.length && !includeFolders.some(pref => f.path.startsWith(pref))) continue;
      if (excludeFolders?.length && excludeFolders.some(pref => f.path.startsWith(pref))) continue;

      if (filenameMatches && !norm(f.basename).includes(norm(filenameMatches))) continue;

      if ((requireTags && requireTags.length) || (excludeTags && excludeTags.length)) {
        const cache = meta.getFileCache(f);
        const tagsOnFile = new Set<string>(
          (cache?.tags ?? []).map(t => "#" + t.tag.replace(/^#/, ""))
        );
        let allowed = true;
        if (requireTags && requireTags.length) {
          allowed = requireTags.some(t => tagsOnFile.has(t));
        }
        if (allowed && excludeTags && excludeTags.length) {
          allowed = !excludeTags.some(t => tagsOnFile.has(t));
        }
        if (!allowed) continue;
      }

      if (q) {
        if (this.settings.fuzzy) {
          if (!fuzzyMatch(q, f.basename)) continue;
        } else {
          if (!norm(f.basename).includes(norm(q))) continue;
        }
      }

      out.push({ kind: "page", file: f, name: f.basename, path: f.path });
      if (out.length >= this.settings.maxResults) break;
    }
    return out;
  }

  private async getCommandSuggestions(q: string, trig: TriggerConfig) {
    const cmds = Object.values(this.appRef.commands.commands);
    const { includeIds, includeNamesContains, excludeIds } = trig.commandFilters ?? {};
    const out: SuggestItem[] = [];
    const norm = (s: string) => s.toLowerCase();

    for (const c of cmds) {
      if (!c.id) continue;
      if (includeIds?.length && !includeIds.includes(c.id)) continue;
      if (excludeIds?.length && excludeIds.includes(c.id)) continue;
      if (includeNamesContains && !norm(c.name).includes(norm(includeNamesContains))) continue;

      const matchesQ = !q ||
        (this.settings.fuzzy ? (fuzzyMatch(q, c.name) || fuzzyMatch(q, c.id)) :
                               (norm(c.name).includes(norm(q)) || norm(c.id).includes(norm(q))));
      if (!matchesQ) continue;

      out.push({ kind: "command", id: c.id, name: c.name });
      if (out.length >= this.settings.maxResults) break;
    }
    return out;
  }

  private async getTagSuggestions(q: string, trig: TriggerConfig) {
    const tagsObj = this.appRef.metadataCache.getTags();
    const all = Object.keys(tagsObj).sort(); // "#tag": count
    const { include, exclude, contains } = trig.tagFilters ?? {};
    const norm = (s: string) => s.toLowerCase();

    const out: SuggestItem[] = [];
    for (const t of all) {
      if (include?.length && !include.includes(t)) continue;
      if (exclude?.length && exclude.includes(t)) continue;
      if (contains && !norm(t).includes(norm(contains.startsWith("#") ? contains : "#" + contains))) continue;

      const display = t.replace(/^#/, "");
      const matchesQ = !q ||
        (this.settings.fuzzy ? (fuzzyMatch(q, display) || fuzzyMatch(q, t)) :
                               (norm(display).includes(norm(q)) || norm(t).includes(norm(q))));
      if (!matchesQ) continue;

      out.push({ kind: "tag", tag: t, name: display });
      if (out.length >= this.settings.maxResults) break;
    }
    return out;
  }
}

// Lightweight fuzzy matcher (subsequence)
function fuzzyMatch(needle: string, hay: string): boolean {
  needle = needle.toLowerCase();
  hay = hay.toLowerCase();
  let idx = 0;
  for (const ch of hay) {
    if (ch === needle[idx]) idx++;
    if (idx === needle.length) return true;
  }
  return needle.length === 0;
}