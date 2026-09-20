import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { ContentSource, RawItem } from "./source";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function fixtureSource(items?: RawItem[]): ContentSource {
  return {
    async fetchRecent(): Promise<RawItem[]> {
      if (items) {
        // Return injected items unchanged
        return items;
      }

      // Load from the default JSON fixture file
      const fixtureePath = join(__dirname, "fixtures", "delhi-signals.json");
      const fileContent = readFileSync(fixtureePath, "utf-8");
      const parsed = JSON.parse(fileContent) as Array<{
        sourceId: string;
        text: string;
        occurredAt: string;
        url?: string;
      }>;

      // Convert ISO date strings to Date instances
      return parsed.map((item) => ({
        sourceId: item.sourceId,
        text: item.text,
        occurredAt: new Date(item.occurredAt),
        ...(item.url ? { url: item.url } : {}),
      }));
    },
  };
}
