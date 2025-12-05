export type SourceType = "pages" | "commands" | "tags";

export interface PageFilters {
  includeFolders?: string[];     // only these folders (prefix match)
  excludeFolders?: string[];     // exclude these folders (prefix match)
  requireTags?: string[];        // page must have at least one of these tags
  excludeTags?: string[];        // page must not have any of these tags
  filenameMatches?: string;      // simple substring match
}

export interface CommandFilters {
  includeIds?: string[];         // only these command ids
  includeNamesContains?: string; // case-insensitive substring on display name
  excludeIds?: string[];
}

export interface TagFilters {
  include?: string[];            // whitelist of tags (e.g., #research)
  exclude?: string[];            // blacklist
  contains?: string;             // substring match without '#'
}

export interface TriggerConfig {
  /** Single-character symbol that starts the suggester (e.g., "@", ";", "%") */
  symbol: string;

  /** Friendly name for settings UI */
  name: string;

  /** Source of suggestions */
  source: SourceType;

  /** Filters vary by source */
  pageFilters?: PageFilters;
  commandFilters?: CommandFilters;
  tagFilters?: TagFilters;

  /**
   * Template for inserted text.
   * Available placeholders vary by source:
   *
   * pages:
   *   {{link}}     → [[Note]]
   *   {{path}}     → folder/path/Note.md
   *   {{name}}     → Note
   *   {{display}}  → Note (same as name)
   *
   * commands:
   *   {{id}}       → command id
   *   {{name}}     → display name
   *
   * tags:
   *   {{tag}}      → #tag
   *   {{name}}     → tag without '#'
   *
   * All:
   *   {{cursor}}   → caret will be placed here after insertion
   */
  template: string;

  /**
   * When true, wrap an existing token (word before cursor) instead of replacing the typed trigger.
   * If false (default), replace the trigger and its query text.
   */
  wrapPreviousWord?: boolean;

  /**
   * If true, keep the inserted text selected so the user can immediately overwrite.
   */
  selectAfterInsert?: boolean;
}

export interface PluginSettings {
  triggers: TriggerConfig[];
  /** If true, suggestion filtering is fuzzy; otherwise plain substring match. */
  fuzzy: boolean;
  /** Max results to show in the suggester. */
  maxResults: number;
}