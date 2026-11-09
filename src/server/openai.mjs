import OpenAI from "openai";

let client;
export function openAi() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing");
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
  return client;
}

export const MODEL = process.env.EDITORIAL_MODEL || "gpt-6-luna";

const MODEL_PRICES_PER_MILLION = {
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "gpt-6.1-terra": { input: 1, output: 5 },
};

export async function structuredResponse({ name, schema, instructions, input, webSearch = false }) {
  await assertBudgetAvailable();
  const response = await openAi().responses.create({
    model: MODEL,
    instructions,
    input,
    ...(webSearch ? { tools: [{ type: "web_search" }], tool_choice: "required" } : {}),
    text: { format: { type: "json_schema", name, strict: true, schema } },
    store: false,
  });
  await accountCost(response);
  const text = response.output_text;
  if (!text) throw new Error(`Empty response for ${name}`);
  return { data: JSON.parse(text), response };
}

async function assertBudgetAvailable() {
  const cap = Number(process.env.EDITORIAL_MONTHLY_BUDGET_USD || 20);
  const { getConnectionString } = await import("@netlify/database");
  const postgres = (await import("postgres")).default;
  const sql = postgres(getConnectionString(), { max: 1 });
  let spend = 0;
  try {
    const rows = await sql`SELECT estimated_usd FROM api_usage_monthly WHERE month = date_trunc('month', now())::date LIMIT 1`;
    spend = Number(rows[0]?.estimated_usd || 0);
  } finally { await sql.end(); }
  if (Number.isFinite(cap) && spend >= cap) throw new Error("Editorial monthly API budget reached; generation paused");
}

async function accountCost(response) {
  const { getConnectionString } = await import("@netlify/database");
  const postgres = (await import("postgres")).default;
  const sql = postgres(getConnectionString(), { max: 1 });
  const prices = MODEL_PRICES_PER_MILLION[MODEL];
  if (!prices) throw new Error(`No monthly cost model configured for ${MODEL}`);
  const estimated = Number(response.usage?.input_tokens || 0) * prices.input / 1_000_000
    + Number(response.usage?.output_tokens || 0) * prices.output / 1_000_000
    + (response.output || []).filter((item) => item.type === "web_search_call").length * 0.01;
  try {
    await sql`
      INSERT INTO api_usage_monthly (month, estimated_usd, requests)
      VALUES (date_trunc('month', now())::date,
        ${estimated}, 1)
      ON CONFLICT (month) DO UPDATE SET
        estimated_usd = api_usage_monthly.estimated_usd + EXCLUDED.estimated_usd,
        requests = api_usage_monthly.requests + 1
    `;
  } finally { await sql.end(); }
}

export function citationsFrom(response) {
  const citations = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      for (const annotation of content.annotations ?? []) {
        if (annotation.type === "url_citation" && annotation.url) {
          citations.push({ url: annotation.url, title: annotation.title ?? "" });
        }
      }
    }
  }
  return [...new Map(citations.map((item) => [item.url, item])).values()];
}
