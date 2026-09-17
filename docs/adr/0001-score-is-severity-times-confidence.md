# Score is Severity times Confidence, and Evidence volume cannot touch Severity

A Building's Score is its estimated risk of harm to occupants, aggregated across its open Hazards from each Hazard's Severity (how bad it is if real) and Confidence (how well the Evidence supports it being real). Volume of Evidence feeds Confidence only and can never raise Severity.

We chose this over the obvious single blended 0-100 because blending lets attention masquerade as danger: a Building with fifty angry tweets and no structural problem would outrank one with a single photographed foundation crack. That inversion is the failure that would make Catastrophy untrustworthy to residents and authorities alike, and it is not recoverable by tuning weights afterwards.

## Consequences

- Severity and Confidence are surfaced separately in every Assessment. "High Severity, low Confidence" is a materially different situation for a resident than "high Severity, high Confidence", and a single number hides which one they are in.
- The Score itself is never shown. It exists to order Hazards, drive heatmap intensity, and roll up across a Society. What people see is the Alert Level it bands into, because a number like 73 invites a precision this estimate does not have.
- A widely reported Building will not outrank a credibly reported one. This will look like a bug to anyone who has not read this document. It is not.
- Confidence is capped per Reporter, so one determined person cannot manufacture a high Score by submitting repeatedly.
