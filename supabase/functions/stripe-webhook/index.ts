import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const STRIPE_SECRET_KEY     = Deno.env.get("STRIPE_SECRET_KEY")!;

/** Verify a Stripe webhook signature using the HMAC-SHA256 scheme. */
async function verifyStripeSignature(
  payload:   string,
  sigHeader: string,
  secret:    string,
): Promise<boolean> {
  const parts     = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const timestamp = parts["t"];
  const sig       = parts["v1"];
  if (!timestamp || !sig) return false;

  const signed  = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key     = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac        = await crypto.subtle.sign("HMAC", key, encoder.encode(signed));
  const expected   = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return expected === sig;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const sigHeader = req.headers.get("stripe-signature") ?? "";
  const body      = await req.text();

  const valid = await verifyStripeSignature(body, sigHeader, STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    console.error("Invalid Stripe signature");
    return new Response("Invalid signature", { status: 400 });
  }

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  switch (event.type) {
    case "checkout.session.completed": {
      const session    = event.data.object as Record<string, unknown>;
      const metadata   = session["metadata"] as Record<string, string> | null;
      const customerId = session["customer"] as string | null;
      const subId      = session["subscription"] as string | null;
      const userId     = metadata?.["user_id"];

      if (!userId) {
        console.error("No user_id in checkout session metadata");
        break;
      }

      await supabase.from("user_preferences").upsert({
        user_id:                userId,
        is_premium:             true,
        stripe_customer_id:     customerId,
        stripe_subscription_id: subId,
      });

      console.log(`Activated premium for user ${userId}`);
      break;
    }

    case "customer.subscription.deleted": {
      // Subscription cancelled / expired — revoke premium
      const sub        = event.data.object as Record<string, unknown>;
      const metadata   = (sub["metadata"] as Record<string, string> | null);
      const customerId = sub["customer"] as string | null;
      let   userId     = metadata?.["user_id"];

      if (!userId && customerId) {
        // Fall back: look up user by customer ID
        const { data } = await supabase
          .from("user_preferences")
          .select("user_id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();
        userId = data?.user_id;
      }

      if (!userId) {
        console.error("No user_id for subscription.deleted event");
        break;
      }

      await supabase.from("user_preferences").upsert({
        user_id:    userId,
        is_premium: false,
      });

      console.log(`Revoked premium for user ${userId}`);
      break;
    }

    case "invoice.payment_failed": {
      // Optional: you could notify the user here; for now just log it.
      const invoice    = event.data.object as Record<string, unknown>;
      const customerId = invoice["customer"] as string | null;
      console.warn(`Payment failed for customer ${customerId}`);
      break;
    }

    default:
      // Unhandled event — return 200 so Stripe doesn't retry
      break;
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
