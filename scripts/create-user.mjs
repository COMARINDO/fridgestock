import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error(
      "Missing .env.local. Create it from .env.local.example first."
    );
  }

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

async function main() {
  loadEnvLocal();

  const supabaseUrl = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const name = process.argv[2] ?? "sebastian";
  const password = process.argv[3] ?? "1234";

  const { error } = await supabase
    .from("users")
    .upsert({ name, password }, { onConflict: "name" });

  if (error) throw error;

  console.log(`OK: user '${name}' created/updated.`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});

