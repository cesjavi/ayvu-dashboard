import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function generateKey(): { fullKey: string; prefix: string; hash: string } {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const randomPart = Array.from({ length: 40 }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length)),
  ).join("");
  const prefix = randomPart.slice(0, 8);
  const fullKey = `nac_${prefix}_${randomPart.slice(8)}`;
  // Simple hash using crypto.subtle
  const hash = Array.from(
    new Uint8Array(
      crypto.subtle ? new TextEncoder().encode(fullKey).buffer as ArrayBuffer : new ArrayBuffer(0),
    ),
  ).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { fullKey, prefix, hash };
}

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { workspaceId, name } = body;

    if (!workspaceId || !name?.trim()) {
      return new Response(JSON.stringify({ error: "workspaceId and name are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify user is an admin of this workspace
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!membership || membership.role !== "admin") {
      return new Response(JSON.stringify({ error: "Only workspace admins can generate API keys" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Also check if user owns the workspace
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("created_by")
      .eq("id", workspaceId)
      .single();

    const isOwner = workspace?.created_by === user.id;

    if (membership.role !== "admin" && !isOwner) {
      return new Response(
        JSON.stringify({ error: "Only workspace admins can generate API keys" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Generate the key
    const { fullKey, prefix } = generateKey();
    const keyHash = await hashKey(fullKey);

    // Store in DB
    const { error: insertError } = await supabase.from("workspace_api_keys").insert({
      workspace_id: workspaceId,
      name: name.trim(),
      key_prefix: prefix,
      key_hash: keyHash,
      created_by: user.id,
    });

    if (insertError) {
      return new Response(JSON.stringify({ error: `Failed to create API key: ${insertError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, key: fullKey, prefix }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});