import { Plugin, Notice } from "obsidian";
import { DEFAULT_SETTINGS, CustomMentionsSettingTab } from "./settings";
import type { PluginSettings } from "./types";
import { MultiTriggerSuggest } from "./trigger-suggester";

export default class CustomMentionsPlugin extends Plugin {
  settings: PluginSettings;
  private suggester: MultiTriggerSuggest | null = null;

  async onload() {
    await this.loadSettings();

	this.suggester = new MultiTriggerSuggest(this.app, this.settings, this); // <-- pass `this` (the plugin is a Component)
    this.registerEditorSuggest(this.suggester);

    this.addSettingTab(new CustomMentionsSettingTab(this.app, this));

    this.registerEvent(this.app.metadataCache.on("changed", () => {
      // no-op: suggestions refresh on demand
    }));

    this.addCommand({
      id: "custom-mentions-reload",
      name: "Reload Custom Mentions",
      callback: async () => {
        await this.reloadSuggesters();
        new Notice("Custom Mentions reloaded.");
      }
    });
  }

  onunload() {
    // EditorSuggest will be auto-unregistered
  }

  async reloadSuggesters() {
    if (this.suggester) {
      this.suggester.updateSettings(this.settings);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    await this.reloadSuggesters();
  }
}