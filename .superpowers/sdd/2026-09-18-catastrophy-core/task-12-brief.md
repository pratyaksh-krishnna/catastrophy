### Task 12: Escalation routing and delivery

**Files:**
- Create: `src/escalation/routing.ts`, `src/escalation/send.ts`
- Test: `src/escalation/routing.test.ts`, `src/escalation/send.test.ts`

**Interfaces:**
- Consumes: `HAZARD_CATALOGUE`/`severityOf` (Task 1), `AssessmentRecord` (Task 10), `db` (Task 5)
- Produces: `routeAuthorities(ranked)`, `sendEscalation({ buildingId, assessment, addressText })`, `recordExternalTicket(id, ticket)`, `acknowledgeEscalation(id)`

- [ ] **Step 1: Write the failing tests**

Create `src/escalation/routing.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { routeAuthorities } from "./routing.js";

describe("routeAuthorities", () => {
  it("sends structural problems to MCD", () => {
    expect(routeAuthorities([{ typeId: "slab_deflection", confidence: 0.6 }])).toEqual(["mcd"]);
  });

  it("sends unauthorised construction to DDA", () => {
    expect(routeAuthorities([{ typeId: "unauthorised_storey", confidence: 0.6 }])).toEqual(["dda"]);
  });

  it("adds DDMA alongside MCD when a severity-5 hazard is present", () => {
    const out = routeAuthorities([{ typeId: "column_failure", confidence: 0.9 }]);
    expect(out).toContain("ddma");
    expect(out).toContain("mcd");
  });

  it("deduplicates authorities across several hazards", () => {
    const out = routeAuthorities([
      { typeId: "slab_deflection", confidence: 0.5 },
      { typeId: "roof_damage", confidence: 0.5 },
    ]);
    expect(out).toEqual(["mcd"]);
  });

  it("routes nothing when there are no open hazards", () => {
    expect(routeAuthorities([])).toEqual([]);
  });
});
```

Create `src/escalation/send.test.ts`:

```typescript
import { describe, it, expect, vi, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { resolveOrCreateBuilding } from "../db/buildings.js";
import { sendEscalation } from "./send.js";

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class { async send() { return {}; } },
  SendEmailCommand: class { constructor(public input: unknown) {} },
}));

afterAll(async () => { await pool.end(); });

describe("sendEscalation", () => {
  it("stores an immutable snapshot of the assessment it was sent with", async () => {
    const tag = `E${Math.random().toString(36).slice(2, 8)}`;
    const b = await resolveOrCreateBuilding({ lat: 28.61, lon: 77.23, addressText: `${tag} Marg` });
    const assessment = {
      buildingId: b.id, score: 0.82, alertLevel: "critical" as const,
      narrative: "n", ranked: [{ typeId: "column_failure" as const, confidence: 0.9 }],
    };

    const ids = await sendEscalation({ buildingId: b.id, assessment, addressText: `${tag} Marg` });
    expect(ids.length).toBeGreaterThan(0);

    const rows = await db.execute(sql`SELECT snapshot, authority FROM escalations WHERE building_id = ${b.id}`);
    const snap = rows.rows[0].snapshot as { alertLevel: string };
    expect(snap.alertLevel).toBe("critical");
  });

  it("later worsening creates a new escalation rather than mutating the old one", async () => {
    const tag = `F${Math.random().toString(36).slice(2, 8)}`;
    const b = await resolveOrCreateBuilding({ lat: 28.62, lon: 77.24, addressText: `${tag} Marg` });
    const base = { buildingId: b.id, narrative: "n", ranked: [{ typeId: "slab_deflection" as const, confidence: 0.5 }] };

    await sendEscalation({ buildingId: b.id, addressText: `${tag} Marg`, assessment: { ...base, score: 0.45, alertLevel: "escalated" } });
    await sendEscalation({ buildingId: b.id, addressText: `${tag} Marg`, assessment: { ...base, score: 0.9, alertLevel: "critical" } });

    const rows = await db.execute(sql`SELECT alert_level FROM escalations WHERE building_id = ${b.id}`);
    expect(rows.rows.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/escalation`
Expected: FAIL — cannot resolve `./routing.js`

- [ ] **Step 3: Write the routing**

Create `src/escalation/routing.ts`:

```typescript
import { HAZARD_CATALOGUE, severityOf, type AuthorityId } from "../domain/hazard-catalogue.js";
import type { OpenHazard } from "../domain/score.js";

const IMMINENT_SEVERITY = 5;

/**
 * Structural goes to MCD, unauthorised construction to DDA. A severity-5 hazard
 * additionally reaches DDMA, which is the distinction between the Escalated and
 * Critical bands.
 */
export function routeAuthorities(ranked: OpenHazard[]): AuthorityId[] {
  const out = new Set<AuthorityId>();
  for (const h of ranked) {
    out.add(HAZARD_CATALOGUE[h.typeId].authority);
    if (severityOf(h.typeId) >= IMMINENT_SEVERITY) {
      out.add("ddma");
      out.add("mcd");
    }
  }
  return [...out];
}
```

- [ ] **Step 4: Write the delivery**

```bash
npm i @aws-sdk/client-ses
```

Create `src/escalation/send.ts`:

```typescript
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { HAZARD_CATALOGUE } from "../domain/hazard-catalogue.js";
import type { AssessmentRecord } from "../db/assessments.js";
import { routeAuthorities } from "./routing.js";

const ses = new SESClient({ region: process.env.AWS_REGION });

/**
 * No Delhi authority exposes an API, so an Escalation is email of record plus a
 * pre-filled complaint an Office-bearer submits by hand. The snapshot is frozen:
 * "what did we tell them, and when" is the first question asked after a collapse.
 */
export async function sendEscalation(input: {
  buildingId: string;
  addressText: string;
  assessment: AssessmentRecord;
}): Promise<string[]> {
  const authorities = routeAuthorities(input.assessment.ranked);
  const ids: string[] = [];

  for (const authority of authorities) {
    const r = await db.execute(sql`
      INSERT INTO escalations (building_id, authority, snapshot)
      VALUES (${input.buildingId}, ${authority}, ${JSON.stringify(input.assessment)}::jsonb)
      RETURNING id`);
    const id = r.rows[0].id as string;
    ids.push(id);

    await ses.send(
      new SendEmailCommand({
        Source: process.env.SES_FROM!,
        Destination: { ToAddresses: [process.env.ESCALATION_INBOX!] },
        Message: {
          Subject: { Data: `[${input.assessment.alertLevel.toUpperCase()}] ${input.addressText} — ref ${id}` },
          Body: { Text: { Data: body(input.addressText, input.assessment, authority, id) } },
        },
      }),
    );
  }
  return ids;
}

function body(addressText: string, a: AssessmentRecord, authority: string, ref: string): string {
  const hazards = a.ranked
    .map((h, i) => `${i + 1}. ${HAZARD_CATALOGUE[h.typeId].label}` +
      (HAZARD_CATALOGUE[h.typeId].byelawRef ? ` [${HAZARD_CATALOGUE[h.typeId].byelawRef}]` : ""))
    .join("\n");

  return [
    `Building: ${addressText}`,
    `Alert level: ${a.alertLevel}`,
    `Reference: ${ref}`,
    `Addressed to: ${authority.toUpperCase()}`,
    ``,
    `Problems on record, most serious first:`,
    hazards || "none",
    ``,
    a.narrative,
    ``,
    `This report was generated from resident-submitted evidence. Reply to this address`,
    `to acknowledge, or quote the reference above when raising a ticket.`,
  ].join("\n");
}

export async function recordExternalTicket(escalationId: string, ticket: string): Promise<void> {
  await db.execute(sql`UPDATE escalations SET external_ticket = ${ticket} WHERE id = ${escalationId}`);
}

export async function acknowledgeEscalation(escalationId: string): Promise<void> {
  await db.execute(sql`
    UPDATE escalations SET status = 'acknowledged', acknowledged_at = now() WHERE id = ${escalationId}`);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/escalation`
Expected: PASS, 7 tests

- [ ] **Step 6: Commit**

```bash
git add src/escalation package.json
git commit -m "feat: escalation routing by hazard type with immutable assessment snapshots"
```

---

