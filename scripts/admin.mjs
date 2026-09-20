import "dotenv/config";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const [command, first, second] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!first || !uuid.test(first)) {
  throw new Error("Usage: node scripts/admin.mjs resident|office|society|assign-society|ticket|ack <uuid> [name-or-id-or-ticket]");
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  if (command === "resident" || command === "office") {
    // The Evidence id is a private receipt. The reviewer must verify residence
    // or office before running this privileged command.
    const evidence = await client.query("SELECT reporter_id, building_id FROM evidence WHERE id = $1", [first]);
    if (!evidence.rows[0]) throw new Error("Evidence not found");
    const { reporter_id: reporterId, building_id: buildingId } = evidence.rows[0];
    if (command === "resident") {
      await client.query(`INSERT INTO building_residents (reporter_id, building_id, approved_at)
        VALUES ($1, $2, now()) ON CONFLICT (building_id, reporter_id) DO UPDATE SET approved_at = now()`, [reporterId, buildingId]);
      console.log(`Approved resident for Building ${buildingId}`);
    } else {
      const building = await client.query("SELECT society_id FROM buildings WHERE id = $1", [buildingId]);
      const societyId = building.rows[0]?.society_id;
      if (!societyId) throw new Error("Assign this Building to a Society first");
      await client.query(`INSERT INTO office_bearers (society_id, reporter_id, approved_at)
        VALUES ($1, $2, now()) ON CONFLICT (society_id, reporter_id) DO UPDATE SET approved_at = now()`, [societyId, reporterId]);
      console.log(`Approved Office-bearer for Society ${societyId}`);
    }
  } else if (command === "society") {
    if (!second?.trim()) throw new Error("A Society name is required");
    const building = await client.query(`
      SELECT b.id, b.society_id
      FROM buildings b JOIN evidence e ON e.building_id = b.id
      WHERE e.id = $1
      FOR UPDATE OF b
    `, [first]);
    if (!building.rows[0]) throw new Error("Building not found");
    if (building.rows[0].society_id) throw new Error("Building is already assigned to a Society");
    const society = await client.query("INSERT INTO societies (name) VALUES ($1) RETURNING id", [second.trim()]);
    const societyId = society.rows[0].id;
    await client.query("UPDATE buildings SET society_id = $1 WHERE id = $2", [societyId, building.rows[0].id]);
    console.log(`Assigned Building ${building.rows[0].id} to Society ${societyId}`);
  } else if (command === "assign-society") {
    if (!second || !uuid.test(second)) throw new Error("An existing Society id is required");
    const updated = await client.query(`
      UPDATE buildings b SET society_id = $2
      FROM evidence e
      WHERE e.id = $1 AND e.building_id = b.id AND b.society_id IS NULL
        AND EXISTS (SELECT 1 FROM societies WHERE id = $2)
      RETURNING b.id
    `, [first, second]);
    if (!updated.rows[0]) throw new Error("Evidence, unassigned Building, or Society not found");
    console.log(`Assigned Building ${updated.rows[0].id} to Society ${second}`);
  } else if (command === "ticket") {
    if (!second?.trim()) throw new Error("A ticket number is required");
    const updated = await client.query("UPDATE escalations SET external_ticket = $2 WHERE id = $1 RETURNING id", [first, second.trim()]);
    if (!updated.rows[0]) throw new Error("Escalation not found");
    console.log(`Recorded ticket for Escalation ${first}`);
  } else if (command === "ack") {
    const updated = await client.query(`UPDATE escalations SET status = 'acknowledged', acknowledged_at = now()
      WHERE id = $1 AND status = 'sent' RETURNING id`, [first]);
    if (!updated.rows[0]) throw new Error("Sent Escalation not found");
    console.log(`Acknowledged Escalation ${first}`);
  } else {
    throw new Error(`Unknown admin command: ${command}`);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
