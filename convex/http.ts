import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { verifyWebhookSignature, signWebhookPayload } from "../src/lib/security";

const http = httpRouter();

/**
 * GET/POST /api/overdue-loans
 * Called daily by the scheduled n8n Overdue Reminders workflow.
 * Verifies the incoming HMAC-SHA256 signature (`X-LendLoop-Signature`) and signs its JSON response.
 */
http.route({
  path: "/api/overdue-loans",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.LENDLOOP_WEBHOOK_SECRET ?? "";
    const rawBody = await request.text();
    const signature = request.headers.get("x-lendloop-signature");

    if (!verifyWebhookSignature(rawBody, signature, secret)) {
      return new Response(JSON.stringify({ error: "Invalid HMAC signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const parsed = JSON.parse(rawBody || "{}") as { asOfDate?: string };
    const today = parsed.asOfDate ?? new Date().toISOString().slice(0, 10);

    const overdueLoans = await ctx.runQuery(internal.overdue.listOverdueForDate, {
      today,
    });

    const responseBody = JSON.stringify({ today, overdueLoans });
    return new Response(responseBody, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-LendLoop-Signature": signWebhookPayload(responseBody, secret),
      },
    });
  }),
});

/**
 * POST /api/automation-callback
 * Called by n8n after sending a request notification or daily overdue reminder.
 * Verifies the HMAC-SHA256 signature and writes the status back idempotently using `idempotencyKey`.
 */
http.route({
  path: "/api/automation-callback",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.LENDLOOP_WEBHOOK_SECRET ?? "";
    const rawBody = await request.text();
    const signature = request.headers.get("x-lendloop-signature");

    if (!verifyWebhookSignature(rawBody, signature, secret)) {
      return new Response(JSON.stringify({ error: "Invalid HMAC signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(rawBody);
    const result = await ctx.runMutation(internal.loans.recordAutomationWriteback, {
      idempotencyKey: String(payload.idempotencyKey),
      requestId: payload.requestId,
      workflowType: payload.workflowType,
      summary: String(payload.summary),
      status: payload.status === "failed" ? "failed" : "delivered",
      reminderDate: payload.reminderDate ? String(payload.reminderDate) : undefined,
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
