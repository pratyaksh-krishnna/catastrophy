import {
  HAZARD_CATALOGUE,
  HAZARD_TYPE_IDS,
  type HazardTypeId,
} from "../domain/hazard-catalogue";
import type { SourceClass } from "../domain/confidence";
import { converseForTool, type ToolSpec } from "./bedrock";

export interface ClassificationResult {
  hazardTypeIds: HazardTypeId[];
  rationale: string;
}

const SYSTEM = `You classify evidence about building safety in Delhi into a fixed catalogue of hazard types.
Choose only types genuinely supported by the evidence. Choose "other" when nothing fits — never force a match.
Never assess how severe a hazard is; severity is fixed by the catalogue and is not yours to judge.`;

export function classifierTool(): ToolSpec {
  const catalogue = HAZARD_TYPE_IDS.map(
    (id) => `${id}: ${HAZARD_CATALOGUE[id].label}`,
  ).join("\n");

  return {
    name: "record_hazards",
    description: `Record which hazard types this Evidence supports.\n\nCatalogue:\n${catalogue}`,
    inputSchema: {
      type: "object",
      properties: {
        hazardTypeIds: {
          type: "array",
          items: { type: "string", enum: [...HAZARD_TYPE_IDS] },
          description: "Hazard Types this Evidence supports. Empty if none.",
        },
        rationale: {
          type: "string",
          description: "One sentence explaining what in the Evidence supports this classification.",
        },
      },
      required: ["hazardTypeIds", "rationale"],
      additionalProperties: false,
    },
  };
}

export async function classifyEvidence(input: {
  note: string;
  sourceClass: SourceClass;
}): Promise<ClassificationResult> {
  const raw = await converseForTool<unknown>({
    system: SYSTEM,
    prompt: `Source class: ${input.sourceClass}\n\nEvidence:\n${input.note}`,
    tool: classifierTool(),
  });

  const document =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const candidates = Array.isArray(document.hazardTypeIds) ? document.hazardTypeIds : [];
  const allowed = new Set<string>(HAZARD_TYPE_IDS);

  return {
    hazardTypeIds: candidates.filter(
      (id): id is HazardTypeId => typeof id === "string" && allowed.has(id),
    ),
    rationale: typeof document.rationale === "string" ? document.rationale : "",
  };
}
