# Catastrophy

Catastrophy collects evidence about unsafe buildings in Delhi, infers what is wrong with each one, and escalates the dangerous cases to the authorities who can act on them.

## The subject

**Building**:
A single structure at a geocoded point, identified by that point plus the address string a Reporter gave it. Distinct buildings at one address are distinct Buildings.
_Avoid_: Property, site, premises, structure

**Society**:
A registered collective of residents responsible for one or more Buildings. A Society rolls up the Scores of its Buildings but never holds an Assessment of its own.
_Avoid_: RWA, association, complex, community

**Reporter**:
Anyone who submits Evidence, whether or not they belong to the Society responsible for the Building. Membership confers standing to act, never exclusive standing to report.
_Avoid_: User, resident, complainant, witness

**Office-bearer**:
The person who acts on a Society's behalf: raising Escalations, seeing exact locations for its Buildings, and making Resolution Claims. The role is granted by approval, never by assertion.
_Avoid_: Admin, owner, representative, secretary

## Evidence and inference

**Evidence**:
One submitted artefact about a Building — a photo, video, written account, social post, or news item — carrying a location, a Source Class, and a time.
_Avoid_: Report, submission, complaint, tip

**Area Signal**:
Content located to a heatmap cell but not to any Building, such as an article or post naming only a locality. Area Signals populate the public feed and never touch a Building's Hazards, Confidence, or Score. A scraped item becomes Evidence only once it names a Building specifically enough to match one.
_Avoid_: Evidence, mention, chatter, report

**Source**:
A concrete origin that Evidence is drawn from — a named news outlet, civic forum, or feed. Every Source carries a Source Class, and a Source enters circulation only by human admission.
_Avoid_: Feed, site, publisher

**Source Class**:
The kind of origin an Evidence item has, from official record down to social post, carrying the weight that origin lends to Confidence.
_Avoid_: Source type, channel, provenance

**Hazard Type**:
One entry in the catalogue of recognised building problems, carrying a base Severity. New kinds of problem enter the catalogue only by review, never by invention at classification time.
_Avoid_: Category, class, tag

**Hazard**:
A Hazard Type inferred to be present at a Building, such as a cracked load-bearing wall or an unauthorised additional storey. Evidence supports Hazards; one piece of Evidence may support several, and one Hazard may rest on many.
_Avoid_: Issue, problem, defect, incident

**Assessment**:
The current generated account of a Building: its open Hazards in priority order, with the Building's Score and Alert Level. An Assessment is replaced wholesale when it changes, never appended to.
_Avoid_: Report, analysis, summary

## Judgement

**Severity**:
How much harm a Hazard would cause if it is real. A property of the Hazard Type, grounded in building law rather than in what anyone reports or feels.

**Confidence**:
How strongly the Evidence supports the claim that a Hazard is real. Independent Reporters, Source Class, corroboration across classes, and recency raise it; volume from any single Reporter cannot.
_Avoid_: Certainty, trust, reliability

**Score**:
A Building's estimated risk of harm to its occupants, aggregated across its open Hazards from each one's Severity and Confidence. It orders Hazards, drives heatmap intensity, and rolls up across a Society, and it is never shown to anyone.
_Avoid_: Rating, grade, index

**Alert Level**:
The four-band state of a Building derived from its Score, and the only expression of risk anyone outside the system sees. Named for the action it calls for: Monitor, Act, Escalated, or Critical. A property a Building holds, not an event that occurs.
_Avoid_: Alert, emergency level, status, tier

## Acting on it

**Escalation**:
One outbound notification about a Building to an authority, carrying an immutable snapshot of the Assessment that prompted it, tracked from sent through acknowledged to resolved.
_Avoid_: Case, ticket, alert, referral

**Resolution Claim**:
An assertion by an Office-bearer that a Hazard has been remedied. It must carry fresh Evidence, and any Reporter may dispute it during a contest window, which reopens the Hazard. A Building at Critical cannot be resolved this way at all.
_Avoid_: Closure, fix, sign-off
