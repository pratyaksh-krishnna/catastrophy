import { serve } from "inngest/next";
import { inngest } from "../../../pipeline/inngest";
import {
  regenerateAssessment,
  regenerateAssessmentUrgent,
} from "../../../pipeline/regenerate";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [regenerateAssessment, regenerateAssessmentUrgent],
});
