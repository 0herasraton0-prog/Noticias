import { openDatabase } from "../../src/server/db.mjs";
import { runEditorialCycle } from "../../src/server/pipeline.mjs";

export default async (request) => {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("x-cron-secret");
  if (expected && supplied !== expected) return new Response("Unauthorized", { status: 401 });
  let cycleInput;
  try { cycleInput = await request.json(); } catch { return new Response("Invalid cycle payload", { status: 400 }); }
  const scheduledAt = new Date(cycleInput.scheduledAt);
  if (!Number.isFinite(scheduledAt.getTime())) return new Response("Invalid scheduledAt", { status: 400 });

  const sql = openDatabase();
  let cycleId;
  try {
    let existing = await sql`
      INSERT INTO editorial_cycles (scheduled_for, status, started_at)
      VALUES (${scheduledAt}, 'processing', now())
      ON CONFLICT (scheduled_for) DO NOTHING
      RETURNING id, status
    `;
    if (!existing.length) {
      const prior = await sql`SELECT id, status FROM editorial_cycles WHERE scheduled_for = ${scheduledAt} LIMIT 1`;
      if (!prior.length || ["completed", "processing"].includes(prior[0].status)) {
        await sql.end();
        return new Response("Cycle already processed or running", { status: 200 });
      }
      existing = await sql`UPDATE editorial_cycles SET status = 'processing', started_at = now() WHERE id = ${prior[0].id} AND status IN ('failed', 'queued') RETURNING id, status`;
      if (!existing.length) {
        await sql.end();
        return new Response("Cycle already claimed", { status: 200 });
      }
    }
    const cycle = existing[0];
    cycleId = cycle.id;
    const run = async () => {
      try {
        const report = await runEditorialCycle(sql, { cycleId: cycle.id, scheduledAt: scheduledAt.toISOString() });
        await sql`UPDATE editorial_cycles SET status = 'completed', finished_at = now(), report = ${sql.json(report)} WHERE id = ${cycle.id}`;
        await sql`INSERT INTO cycle_reports (cycle_id, stage, outcome, details) VALUES (${cycle.id}, 'cycle', 'completed', ${sql.json(report)})`;
      } catch (error) {
        const details = { error: String(error.message).slice(0, 1000) };
        await sql`UPDATE editorial_cycles SET status = 'failed', finished_at = now(), report = ${sql.json(details)} WHERE id = ${cycle.id}`.catch(() => {});
        await sql`INSERT INTO cycle_reports (cycle_id, stage, outcome, details) VALUES (${cycle.id}, 'cycle', 'failed', ${sql.json(details)})`.catch(() => {});
        console.error("Editorial cycle failed", details);
      } finally { await sql.end(); }
    };
    await run();
    return new Response("Cycle completed", { status: 200 });
  } catch (error) {
    const details = { error: String(error.message).slice(0, 1000) };
    if (cycleId) {
      await sql`UPDATE editorial_cycles SET status = 'failed', finished_at = now(), report = ${sql.json(details)} WHERE id = ${cycleId}`.catch(() => {});
      await sql`INSERT INTO cycle_reports (cycle_id, stage, outcome, details) VALUES (${cycleId}, 'cycle', 'failed', ${sql.json(details)})`.catch(() => {});
    }
    await sql.end();
    console.error("Editorial cycle failed", details);
    return new Response("Cycle failed", { status: 500 });
  }
};

export const config = { background: true };
