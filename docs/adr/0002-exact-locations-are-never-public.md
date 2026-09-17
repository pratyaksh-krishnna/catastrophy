# Exact Building locations are never public

The public sees a heatmap and nothing else: no address, no Score, no Hazard detail. Exact location reaches only a Building's own residents and Society, and the authorities an Escalation is sent to. Heatmap cells render only where at least five distinct reported Buildings fall inside them, merging upward into coarser cells until that threshold is met, and never expose their underlying counts.

We chose this over publishing Assessments above a Confidence threshold, which was the earlier proposal. Publicly labelling a named building unsafe is a defamation exposure, it moves property values, and it is a ready-made weapon in tenant-landlord and neighbour disputes. A threshold only changes how often that harm lands, not whether the product can inflict it. Withholding location removes the harm rather than rationing it, and costs the public view almost nothing it needed.

## Consequences

- The map is deliberately coarse in sparse areas, which will look like a rendering limitation or a bug. It is the point: one hot cell in a sparse area is an address.
- A Reporter sees the status of their own Evidence, but never the target Building's full Assessment. Otherwise filing a report becomes a way to unlock an address.
- Anything that pins content to a specific Building in the public view reopens this, no matter how public that content already was elsewhere. A public post becomes a new disclosure once Catastrophy asserts which building it is about.
- The public feed therefore shows a written summary of what is being reported in a cell, never the underlying posts. Posts routinely name their own building, so relaying them verbatim would make the cell-level boundary decorative. Redaction was rejected as the weaker option: it has to catch every way an address can be written, and it fails silently when it does not.
- Text-derived locations resolve to a cell and stop there. They never create a Building, move one, or support a Hazard, because a locality centroid would otherwise attach itself to whichever Building happened to be nearest.
