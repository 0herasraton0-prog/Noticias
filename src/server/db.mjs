import { getConnectionString } from "@netlify/database";
import postgres from "postgres";

export function openDatabase() {
  const connectionString = getConnectionString();
  return postgres(connectionString, { max: 1, idle_timeout: 5, connect_timeout: 10 });
}
