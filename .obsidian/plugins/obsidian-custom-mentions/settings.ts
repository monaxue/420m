import { App, PluginSettingTab, Setting, TextAreaComponent, Notice } from "obsidian";
import type CustomMentionsPlugin from "./main";
import type { PluginSettings, TriggerConfig } from "./types";

export const DEFAULT_SETTINGS: PluginSettings = {
  fuzzy: true,
  maxResults: 50,
  triggers: [
    {
      symbol: "@",
      name: "Pages (everywhere)",
      source: "pages",
      pageFilters: {
        excludeFolders: [".obsidian/"]
      },
      template: "{{link}}",
      wrapPreviousWord: false
    },
    {
      symbol: ";",
      name: "Commands",
      source: "commands",
      commandFilters: {
        includeNamesContains: ""
      },
      template: "{{name}} ({{id}})",
      wrapPreviousWord: false
    },
    {
      symbol: "#",
      name: "Tags",
      source: "tags",
      template: "{{tag}}{{cursor}}",
      wrapPreviousWord: false
    }
  ]
};

export class CustomMentionsSettingTab extends PluginSettingTab {
  plugin: CustomMentionsPlugin;

  constructor(app: App, plugin: CustomMentionsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Custom Mentions — Settings" });

    new Setting(containerEl)
      .setName("Fuzzy search")
      .setDesc("When enabled, suggestions use basic fuzzy matching.")
      .addToggle(t =>
        t.setValue(this.plugin.settings.fuzzy)
          .onChange(async (v) => {
            this.plugin.settings.fuzzy = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Max results")
      .setDesc("Maximum number of suggestions to display.")
      .addText(t =>
        t.setPlaceholder("50")
          .setValue(String(this.plugin.settings.maxResults))
          .onChange(async (v) => {
            const n = Number(v);
            if (!Number.isNaN(n) && n > 0) {
              this.plugin.settings.maxResults = Math.min(n, 500);
              await this.plugin.saveSettings();
            }
          })
      );

    containerEl.createEl("h3", { text: "Triggers (JSON)" });
    const desc = containerEl.createEl("div", { cls: "setting-item-description" });
    desc.setText(
      "Power-user editor: edit, add, or remove trigger configs as JSON. Reloads when you click Save."
    );

    const textArea = new TextAreaComponent(containerEl);
    textArea.inputEl.rows = 16;
    textArea.inputEl.style.width = "100%";
    textArea.setValue(JSON.stringify(this.plugin.settings.triggers, null, 2));

    const btnRow = containerEl.createDiv({ cls: "cm-trigger-row" });
    const saveBtn = btnRow.createEl("button", { text: "Save triggers" });
    saveBtn.addEventListener("click", async () => {
      try {
        const parsed = JSON.parse(textArea.getValue()) as TriggerConfig[];
        // Basic validation
        const problems: string[] = [];
        const symbols = new Set<string>();
        for (const trig of parsed) {
          if (!trig.symbol || trig.symbol.length !== 1) {
            problems.push(`Trigger "${trig.name ?? "unnamed"}" needs a single-character 'symbol'.`);
          } else if (symbols.has(trig.symbol)) {
            problems.push(`Duplicate trigger symbol "${trig.symbol}".`);
          } else {
            symbols.add(trig.symbol);
          }
          if (!trig.source || !["pages", "commands", "tags"].includes(trig.source)) {
            problems.push(`Trigger "${trig.name ?? trig.symbol}" has invalid 'source'.`);
          }
          if (typeof trig.template !== "string") {
            problems.push(`Trigger "${trig.name ?? trig.symbol}" needs a 'template' string.`);
          }
        }
        if (problems.length) {
          new Notice("Trigger errors:\n" + problems.join("\n"));
          return;
        }
        this.plugin.settings.triggers = parsed;
        await this.plugin.saveSettings();
        await this.plugin.reloadSuggesters();
        new Notice("Triggers saved.");
      } catch (e) {
        new Notice("Invalid JSON: " + (e && e.message ? e.message : e));
      }
    });

    // Helpful examples at the bottom
    containerEl.createEl("h3", { text: "Examples" });
    containerEl.createEl("pre", {
      text: JSON.stringify([
        {
          symbol: "%",
          name: "Pages in /Research with #paper",
          source: "pages",
          pageFilters: { includeFolders: ["Research/"], requireTags: ["#paper"] },
          template: "See {{link}} for details{{cursor}}."
        },
        {
          symbol: "!",
          name: "Command mention",
          source: "commands",
          commandFilters: { includeNamesContains: "toggle" },
          template: "{{name}}"
        },
        {
          symbol: "~",
          name: "Tags (only #todo, #idea)",
          source: "tags",
          tagFilters: { include: ["#todo", "#idea"] },
          template: "{{tag}}: {{cursor}}"
        }
      ], null, 2)
    });
  }
}