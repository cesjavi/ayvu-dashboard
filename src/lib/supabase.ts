import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://qeihnzhmyiinbwqhdqji.supabase.co";
const supabaseAnonKey =
  "sb_publishable__Y2_lPNVW_zJhmCcYC_pDA_lFsM6Dui";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: "implicit",
    detectSessionInUrl: true,
  },
});