import { serve } from "inngest/next";
import { inngest } from "../../../pipeline/inngest";
import { ingestAreaSignals } from "../../../pipeline/ingest";
import {
  regenerateAssessment,
  regenerateAssessmentUrgent,
  retryPendingRegenerations,
} from "../../../pipeline/regenerate";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [regenerateAssessment, regenerateAssessmentUrgent, retryPendingRegenerations, ingestAreaSignals],
});
