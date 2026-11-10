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
  if (process.env.EDITORIAL_AUTOMATION_ENABLED !== "true") {
    console.info("Editorial scheduler stopped: EDITORIAL_AUTOMATION_ENABLED is not true");
    return new Response("Editorial automation is paused", { status: 200 });
  }

  const now = new Date();
  const event = await request.json().catch(() => ({}));

  // Netlify's next_run is the next scheduled invocation. The UTC schedule
  // includes both seasonal offsets for Europe/Madrid; infer the invocation
  // that just ran from the preceding slot.
  const scheduledUtcHours = [3, 4, 9, 10, 15, 16, 21, 22];
  let scheduledAt = new Date(now);
  if (event.next_run) {
    const nextRun = new Date(event.next_run);
    if (!Number.isFinite(nextRun.getTime())) {
      console.error("Editorial scheduler received an invalid next_run value");
      return new Response("Invalid scheduled run", { status: 400 });
    }
    const previousHours = scheduledUtcHours.filter((hour) => hour < nextRun.getUTCHours());
    const previousHour = previousHours.at(-1) ?? scheduledUtcHours.at(-1);
    scheduledAt = new Date(nextRun);
    scheduledAt.setUTCHours(previousHour, 0, 0, 0);
    if (!previousHours.length) scheduledAt.setUTCDate(scheduledAt.getUTCDate() - 1);
  }

  const hour = madridHour(scheduledAt);
  console.info("Editorial scheduler checked slot", {
    scheduledAt: scheduledAt.toISOString(),
    madridHour: hour,
  });

  if (!TARGET_HOURS.has(hour)) {
    console.info("Editorial scheduler is resting outside configured Madrid hours");
    return new Response("Rest period", { status: 200 });
  }

  const siteUrl = process.env.NETLIFY_SITE_URL;
  if (!siteUrl) {
    console.error("Editorial scheduler stopped: NETLIFY_SITE_URL is missing");
    return new Response("NETLIFY_SITE_URL missing", { status: 500 });
  }
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("Editorial scheduler stopped: CRON_SECRET is missing");
    return new Response("CRON_SECRET missing", { status: 500 });
  }

  // config.background keeps the endpoint name equal to the filename.
  const backgroundUrl = new URL("/.netlify/functions/process-editorial-cycle", siteUrl);
  let response;
  try {
    response = await fetch(backgroundUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": cronSecret },
      body: JSON.stringify({ scheduledAt: scheduledAt.toISOString() }),
    });
  } catch (error) {
    console.error("Could not reach editorial background function", String(error.message).slice(0, 300));
    return new Response("Could not reach cycle processor", { status: 502 });
  }

  console.info("Editorial background function response", { status: response.status });
  if (response.status !== 202) {
    const details = (await response.text().catch(() => "")).slice(0, 300);
    console.error("Could not start editorial cycle", { status: response.status, details });
    return new Response("Could not start cycle", { status: 502 });
  }

  console.info("Editorial cycle accepted by background function");
  return new Response("Editorial cycle accepted", { status: 200 });
};