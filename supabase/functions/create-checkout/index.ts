import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const PRICE_ID_MONTHLY  = Deno.env.get("STRIPE_PRICE_ID_MONTHLY") ?? "";
const PRICE_ID_YEARLY   = Deno.env.get("STRIPE_PRICE_ID_YEARLY") ?? "";
const APP_URL           = Deno.env.get("APP_URL") ?? "https://tasktriage.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // CORS pre-flight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // ignore
  }
  const plan = body.plan || "yearly";
  const priceId = plan === "monthly" ? PRICE_ID_MONTHLY : PRICE_ID_YEARLY;

  // Authenticate via Supabase JWT
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const supabase   = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized", details: authError?.message || "No user found", header_length: authHeader.length }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Fetch existing preferences to reuse stripe_customer_id if present
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: prefs } = await supabaseAdmin
      .from("user_preferences")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    let customerId: string | undefined = prefs?.stripe_customer_id ?? undefined;

    // Create a Stripe customer if one doesn't exist
    if (!customerId) {
      const custRes = await fetch("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
          "Content-Type":  "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email:                user.email ?? "",
          "metadata[user_id]": user.id,
        }),
      });
      if (!custRes.ok) {
        const err = await custRes.text();
        throw new Error(`Customer creation failed: ${err}`);
      }
      const cust  = await custRes.json();
      customerId  = cust.id;

      // Persist customer ID
      await supabaseAdmin.from("user_preferences").upsert({
        user_id:            user.id,
        stripe_customer_id: customerId,
      });
    }

    // Create Stripe Checkout session
    const sessionBody = new URLSearchParams({
      mode:                                 "subscription",
      customer:                             customerId!,
      "line_items[0][price]":               priceId,
      "line_items[0][quantity]":            "1",
      allow_promotion_codes:                "true",
      success_url:                          `${APP_URL}?checkout=success`,
      cancel_url:                           `${APP_URL}?checkout=cancelled`,
      "subscription_data[metadata][user_id]": user.id,
      "metadata[user_id]":                  user.id,
    });

    const sessionRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type":  "application/x-www-form-urlencoded",
      },
      body: sessionBody,
    });

    if (!sessionRes.ok) {
      const err = await sessionRes.text();
      throw new Error(`Checkout creation failed: ${err}`);
    }

    const session = await sessionRes.json();

    return new Response(JSON.stringify({ url: session.url }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
