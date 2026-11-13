import { createClient } from "@supabase/supabase-js";
import { validatePublicSupabaseConfig } from "./public-supabase-config";
import { fetchAuthWithTimeout } from "./auth-email";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
validatePublicSupabaseConfig(url, key);
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
        global: {
          fetch: (input, init) => {
            const target =
              typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url;
            return new URL(target).pathname.startsWith("/auth/v1/")
              ? fetchAuthWithTimeout(input, init)
              : fetch(input, init);
          },
        },
      })
    : null;
