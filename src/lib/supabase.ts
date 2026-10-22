import { createClient } from "@supabase/supabase-js";
export const demoOnly = process.env.NEXT_PUBLIC_DEMO_ONLY === "true";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const supabase = !demoOnly && url && key ? createClient(url, key) : null;
