import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { fetchRunResult } from "../_shared/run-result.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Extract runId from POST body or GET query param
    let runId: string | null = null;

    if (req.method === "POST") {
      const body = await req.json();
      runId = body.runId ?? null;
    } else if (req.method === "GET") {
      const url = new URL(req.url);
      runId = url.searchParams.get("runId");
    }

    if (!runId) {
      return new Response(JSON.stringify({ error: "runId is required (POST body or ?runId=)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use the user's JWT (from Authorization header) so RLS enforces workspace membership
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader ?? "" } },
    });

    const result = await fetchRunResult(supabase, runId);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const e = err as { error?: string; code?: string; status?: number };
    return new Response(
      JSON.stringify({ error: e.error ?? "Run not found", code: e.code ?? "RUN_NOT_FOUND" }),
      {
        status: e.status ?? 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});