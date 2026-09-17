# Catastrophy — Design Specification

Catastrophy collects evidence about unsafe buildings in Delhi, infers what is wrong with each one, and escalates the dangerous cases to the authorities who can act on them. Built for an AWS hackathon: a demo, shaped like production, with every external feed behind an adapter.

Vocabulary is defined in [CONTEXT.md](../CONTEXT.md). Decisions are recorded in [docs/adr/](./adr/). This document describes the system those two define.

## Hero flow

A resident pins a Building, uploads a geotagged photo with a sentence, and receives an Assessment naming its Hazards in priority order with an Alert Level. One tap escalates to the responsible authority. The status visibly changes when a response comes back. The public heatmap is the landing surface.

## Actors

- **Reporter** — anyone submitting Evidence, member or not. Pseudonymous publicly, identified internally.
- **Office-bearer** — acts for a Society: escalates, sees exact locations, makes Resolution Claims. Granted by manual approval in this build.
- **Authority** — MCD, DDA, DDMA. Receives Escalations by email; no API exists.

## Inference

Evidence is classified into a **Hazard Type** from a closed catalogue of 25 grounded in Delhi's Unified Building Bye-Laws 2016, with an `other` escape hatch that a human promotes into the catalogue when a pattern recurs. Classification is enforced at runtime by a Bedrock Converse `toolConfig` enum, not by prompt instruction.

**Severity** (1–5) is a property of the Hazard Type. It is grounded in building law and changes only by human review with a citation. No feedback loop may move it.

**Confidence** (0–1) is how well Evidence supports a Hazard being real. It rises with the count of *independent Reporters*, the Source Class of their Evidence, corroboration across Source Classes, and recency. A single Reporter's contribution is capped, so volume from one person cannot manufacture Confidence.

**Score** aggregates Severity and Confidence across a Building's open Hazards. It is internal: it orders Hazards, drives heatmap intensity, and rolls up across a Society. Nobody sees it.

**Alert Level** is the four-band public face of Score: `monitor` → `act` → `escalated` → `critical`. The top two bands differ by who is notified. A band above `act` additionally requires a Hazard of matching Severity to be present, so accumulated minor Hazards cannot reach `critical`.

## Assessment lifecycle

An Assessment is replaced wholesale, never appended to. New Evidence triggers regeneration on a short debounce, except Evidence classified into a Severity-5 Hazard Type, which regenerates immediately. An Escalation carries an immutable snapshot of the Assessment that prompted it; a Building worsening later produces a *new* Escalation.

## Location and privacy

See [ADR-0002](./adr/0002-exact-locations-are-never-public.md). Public sees heat only, over cells that render only where at least five distinct reported Buildings fall inside them, merging upward until that threshold is met, never exposing counts. A Reporter sees the status of their own Evidence, not the Building's Assessment. Residents and Office-bearers see their own Buildings in full. Authorities get everything through the Escalation.

Device location is captured at submission. EXIF GPS, when it survives, corroborates: agreement raises Confidence, disagreement flags for review, absence is neutral. Uploads are never hard-rejected for missing geotags. A device fix more than 150m from the claimed Building prompts confirmation.

Originals are stored with EXIF intact — that metadata is part of what makes the file evidence to an authority. Every derivative served below the resident tier is EXIF-stripped.

## Area Signals and the public feed

Scraped articles and posts carry text mentioning a place, not a geotag. They are geocoded to a locality and attached to a **cell**, never to a Building, and become **Area Signals** — which never touch a Building's Hazards, Confidence, or Score. Anything resolving no finer than a district is not mapped at all. The public feed shows a written summary of what is being reported in a cell, never the underlying posts.

## Escalation

Routed by Hazard Type: structural → MCD, unauthorised construction → DDA, Severity 5 → DDMA *and* MCD. Delivered as SES email carrying the Assessment snapshot, plus a generated pre-filled complaint an Office-bearer submits by hand to MCD-311 or PGMS; the returned ticket number is recorded against the Escalation.

A **Resolution Claim** by an Office-bearer requires fresh Evidence and opens a contest window in which any Reporter may dispute it, reopening the Hazard. Authority acknowledgement resolves without contest. A Building at `critical` cannot be resolved by claim at all.

## Agents

Four, all on Bedrock Converse with the model from `MODEL`:

- **Classifier** — Evidence → Hazard Type + Confidence signals. Enum-enforced.
- **Narrator** — Assessment prose, and cell summaries for the public feed.
- **Extractor** — Firecrawl output → structured Evidence or Area Signals.
- **Source Scout** — proposes new Sources for human admission. Never admits them itself.

Feedback moves Source Class weights, classifier accuracy, and catalogue promotion. It never moves Severity.

## External reality

Established by research, 2026-09-18:

- **No government API exists.** MCD-311, PGMS, CPGRAMS and DDA PGRAMS are web forms or apps. Escalation is email plus guided hand-submission.
- **Almost nothing is point-resolvable.** DDA's unauthorised-colonies list is a PDF of 1,731 names without coordinates. Sealed-property lists do not exist publicly. "Illegal land checks" degrades to fuzzy colony-name matching.
- **Delhi is uniformly seismic Zone IV**, so zone cannot differentiate Buildings. Seismic input comes from actual USGS FDSN events (free, no auth, GeoJSON).
- **MPD-2041 is not notified**; MPD-2021 remains operative. NBC 2016 is BIS-copyrighted — internal reference only. UBBL 2016 is freely downloadable and is what the catalogue cites.
- **SACHET** (NDMA) offers a real CAP/RSS feed at district granularity.
- **X has no free tier.** Content is fixture-replayed through the live adapter; Firecrawl targets Delhi news and civic sources instead.

## Stack

TypeScript, Next.js on AWS Amplify. Aurora Serverless v2 PostgreSQL with PostGIS. S3 for media, Amazon Location Service for geocoding, SES for mail. Inngest for debounced regeneration. Bedrock Converse via the AWS SDK, model from `MODEL`.

## Out of scope for this build

Email and WhatsApp notification (in-app only; adapter seam retained). Document-based Office-bearer verification (manual approval; seam retained). Live X ingestion. Automated municipal submission.
