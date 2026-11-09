const TARGET_HOURS = new Set([23, 5, 11, 17]);

function madridHour(date) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Madrid",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date),
  );
}

export default async (request) => {
  // Activation is deliberately opt-in after the billing limit and secrets are configured.
  if (process.env.EDITORIAL_AUTOMATION_ENABLED !== "true") return new Response("Editorial automation is paused", { status: 200 });
  const now = new Date();
  const event = await request.json().catch(() => ({}));
  const scheduledAt = event.next_run ? new Date(event.next_run) : now;
  if (!Number.isFinite(scheduledAt.getTime())) return new Response("Invalid scheduled run", { status: 400 });
  const hour = madridHour(scheduledAt);

  // Netlify invokes this lightweight UTC cron hourly. Outside the agreed
  // Madrid hours it exits without searching or calling the model.
  if (!TARGET_HOURS.has(hour)) {
    return new Response("Rest period", { status: 200 });
  }

  const siteUrl = process.env.NETLIFY_SITE_URL;
  if (!siteUrl) return new Response("NETLIFY_SITE_URL missing", { status: 500 });
  if (!process.env.CRON_SECRET) return new Response("CRON_SECRET missing", { status: 500 });
  const backgroundUrl = new URL("/.netlify/functions/process-editorial-cycle-background", siteUrl);
  const response = await fetch(backgroundUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-secret": process.env.CRON_SECRET || "" },
    body: JSON.stringify({ scheduledAt: scheduledAt.toISOString() }),
  });
  if (response.status !== 202) return new Response("Could not start cycle", { status: 502 });
  return new Response("Editorial cycle accepted", { status: 200 });
};
