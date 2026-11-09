import { openDatabase } from "../../src/server/db.mjs";
import { runEditorialCycle } from "../../src/server/pipeline.mjs";

export default async (request) => {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("x-cron-secret");
  console.info("Editorial processor invoked", {
    cronSecretConfigured: Boolean(expected),
    openAiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
  });

  if (!expected) {
    console.error("Editorial processor stopped: CRON_SECRET is missing");
    return new Response("CRON_SECRET missing", { status: 500 });
  }
  if (supplied !== expected) {
    console.error("Editorial processor stopped: cron secret did not match");
    return new Response("Unauthorized", { status: 401 });
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("Editorial processor stopped: OPENAI_API_KEY is missing");
    return new Response("OPENAI_API_KEY missing", { status: 500 });
  }

  let cycleInput;
  try { cycleInput = await request.json(); } catch {
    console.error("Editorial processor received an invalid JSON payload");
    return new Response("Invalid cycle payload", { status: 400 });
  }
  const scheduledAt = new Date(cycleInput.scheduledAt);
  if (!Number.isFinite(scheduledAt.getTime())) {
    console.error("Editorial processor received an invalid scheduledAt value");
    return new Response("Invalid scheduledAt", { status: 400 });
  }

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
      const prior = await sql`SELECT id, status, report FROM editorial_cycles WHERE scheduled_for = ${scheduledAt} LIMIT 1`;
      if (!prior.length || ["completed", "processing"].includes(prior[0].status)) {
        if (prior[0]?.status === "completed") {
          const report = prior[0].report || {};
          console.info("Previous editorial cycle summary", JSON.stringify({
            scheduledAt: scheduledAt.toISOString(),
            candidates: report.candidates ?? null,
            attempted: report.attempted ?? null,
            published: report.published?.length ?? 0,
            failed: report.failed?.length ?? 0,
          }));
          for (const failure of report.failed || []) {
            console.info("Previous editorial candidate failure", JSON.stringify(failure));
          }
        } else {
          console.info("Editorial cycle already processed or running", { scheduledAt: scheduledAt.toISOString() });
        }
        await sql.end();
        return new Response("Cycle already processed or running", { status: 200 });
      }
      existing = await sql`UPDATE editorial_cycles SET status = 'processing', started_at = now() WHERE id = ${prior[0].id} AND status IN ('failed', 'queued') RETURNING id, status`;
      if (!existing.length) {
        console.info("Editorial cycle was already claimed", { scheduledAt: scheduledAt.toISOString() });
        await sql.end();
        return new Response("Cycle already claimed", { status: 200 });
      }
    }
    const cycle = existing[0];
    cycleId = cycle.id;
    console.info("Editorial cycle started", { cycleId, scheduledAt: scheduledAt.toISOString() });

    const run = async () => {
      try {
        const report = await runEditorialCycle(sql, { cycleId: cycle.id, scheduledAt: scheduledAt.toISOString() });
        await sql`UPDATE editorial_cycles SET status = 'completed', finished_at = now(), report = ${sql.json(report)} WHERE id = ${cycle.id}`;
        await sql`INSERT INTO cycle_reports (cycle_id, stage, outcome, details) VALUES (${cycle.id}, 'cycle', 'completed', ${sql.json(report)})`;
        console.info("Editorial cycle completed", {
          cycleId: cycle.id,
          candidates: report.candidates,
          attempted: report.attempted ?? null,
          published: report.published.length,
          failed: report.failed.length,
          failures: report.failed,
        });
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
