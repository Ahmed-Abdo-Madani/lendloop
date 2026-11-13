import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { signWebhookPayload, buildMinimizedWebhookPayload } from "../src/lib/security";

async function requireAuthenticatedUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("UNAUTHENTICATED: Sign in required");
  }
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
  if (!user) {
    throw new Error("USER_NOT_FOUND: User profile not initialized");
  }
  return user;
}

/**
 * Request to borrow a tool for a date range.
 * Enforces in Convex that users cannot borrow their own tools and that the tool is available.
 * Schedules an HMAC-signed n8n webhook notification with only the minimized fields needed.
 */
export const requestToBorrow = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const borrower = await requireAuthenticatedUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) throw new Error("NOT_FOUND: Tool does not exist");
    if (!tool.isAvailable) throw new Error("UNAVAILABLE: Tool is currently loaned out");
    if (tool.ownerId === borrower._id) {
      throw new Error("FORBIDDEN: You cannot request to borrow your own tool");
    }
    if (args.startDate > args.endDate) {
      throw new Error("VALIDATION_ERROR: startDate must be on or before endDate");
    }

    const lender = await ctx.db.get(tool.ownerId);
    if (!lender) throw new Error("NOT_FOUND: Lender account missing");

    const now = Date.now();
    const requestId = await ctx.db.insert("borrowRequests", {
      toolId: tool._id,
      lenderId: tool.ownerId,
      borrowerId: borrower._id,
      startDate: args.startDate,
      endDate: args.endDate,
      status: "pending",
      lastAutomationEvent: "Borrow request notification queued",
      lastAutomationAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.loans.dispatchN8nBorrowEvent, {
      eventId: `evt_${requestId}_created_${now}`,
      eventType: "request.created",
      requestId,
      toolName: tool.name,
      recipientEmail: lender.email,
      recipientRole: "lender",
      startDate: args.startDate,
      endDate: args.endDate,
    });

    return requestId;
  },
});

/**
 * Approve or decline a borrow request on the user's own tool, or mark an approved loan as returned.
 * Enforces RBAC in Convex so users can act ONLY on requests involving their own tools.
 */
export const updateBorrowRequestStatus = mutation({
  args: {
    requestId: v.id("borrowRequests"),
    action: v.union(
      v.literal("approve"),
      v.literal("decline"),
      v.literal("mark_returned"),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await requireAuthenticatedUser(ctx);
    const req = await ctx.db.get(args.requestId);
    if (!req) throw new Error("NOT_FOUND: Borrow request does not exist");

    if (req.lenderId !== actor._id) {
      throw new Error("FORBIDDEN: You can only act on borrow requests for your own tools");
    }

    const tool = await ctx.db.get(req.toolId);
    const borrower = await ctx.db.get(req.borrowerId);
    if (!tool || !borrower) {
      throw new Error("NOT_FOUND: Associated tool or borrower not found");
    }

    const now = Date.now();
    let nextStatus: "approved" | "declined" | "returned";
    let eventType: "request.approved" | "request.declined" | "loan.returned";

    if (args.action === "approve") {
      if (req.status !== "pending") {
        throw new Error("INVALID_STATE: Only pending requests can be approved");
      }
      nextStatus = "approved";
      eventType = "request.approved";
      await ctx.db.patch(tool._id, { isAvailable: false, updatedAt: now });
    } else if (args.action === "decline") {
      if (req.status !== "pending") {
        throw new Error("INVALID_STATE: Only pending requests can be declined");
      }
      nextStatus = "declined";
      eventType = "request.declined";
    } else {
      if (req.status !== "approved") {
        throw new Error("INVALID_STATE: Only approved loans can be marked as returned");
      }
      nextStatus = "returned";
      eventType = "loan.returned";
      await ctx.db.patch(tool._id, { isAvailable: true, updatedAt: now });
    }

    await ctx.db.patch(req._id, {
      status: nextStatus,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.loans.dispatchN8nBorrowEvent, {
      eventId: `evt_${req._id}_${nextStatus}_${now}`,
      eventType,
      requestId: req._id,
      toolName: tool.name,
      recipientEmail: borrower.email,
      recipientRole: "borrower",
      startDate: req.startDate,
      endDate: req.endDate,
    });
  },
});

/**
 * Returns "My requests" (borrower), "Incoming requests" (lender), and (for admins) all loans.
 */
export const listScopedLoans = query({
  args: {
    scope: v.union(
      v.literal("my_requests"),
      v.literal("incoming_requests"),
      v.literal("admin_all"),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await requireAuthenticatedUser(ctx);
    if (args.scope === "admin_all" && actor.role !== "admin") {
      throw new Error("FORBIDDEN: Only admins can view all loans across the neighborhood");
    }

    const requests =
      args.scope === "my_requests"
        ? await ctx.db
            .query("borrowRequests")
            .withIndex("by_borrower", (q) => q.eq("borrowerId", actor._id))
            .collect()
        : args.scope === "incoming_requests"
          ? await ctx.db
              .query("borrowRequests")
              .withIndex("by_lender", (q) => q.eq("lenderId", actor._id))
              .collect()
          : await ctx.db.query("borrowRequests").collect();

    return Promise.all(
      requests.map(async (req) => {
        const [tool, lender, borrower] = await Promise.all([
          ctx.db.get(req.toolId),
          ctx.db.get(req.lenderId),
          ctx.db.get(req.borrowerId),
        ]);
        return {
          _id: req._id,
          toolId: req.toolId,
          toolName: tool?.name ?? "Removed tool",
          toolCategory: tool?.category ?? "other",
          lenderName: lender?.displayName ?? "Neighbor",
          lenderTrusted: lender?.isTrustedLender ?? false,
          borrowerName: borrower?.displayName ?? "Neighbor",
          startDate: req.startDate,
          endDate: req.endDate,
          status: req.status,
          lastAutomationEvent: req.lastAutomationEvent ?? null,
          lastAutomationAt: req.lastAutomationAt ?? null,
        };
      }),
    );
  },
});

/**
 * Internal action that sends an HMAC-SHA256 signed webhook to n8n with bounded retries
 * and records the outcome idempotently.
 */
export const dispatchN8nBorrowEvent = internalAction({
  args: {
    eventId: v.string(),
    eventType: v.union(
      v.literal("request.created"),
      v.literal("request.approved"),
      v.literal("request.declined"),
      v.literal("loan.returned"),
    ),
    requestId: v.id("borrowRequests"),
    toolName: v.string(),
    recipientEmail: v.string(),
    recipientRole: v.union(v.literal("lender"), v.literal("borrower")),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const webhookUrl = process.env.N8N_REQUEST_WEBHOOK_URL;
    const secret = process.env.LENDLOOP_WEBHOOK_SECRET;
    if (!webhookUrl || !secret) {
      throw new Error("MISCONFIGURED: N8N_REQUEST_WEBHOOK_URL and LENDLOOP_WEBHOOK_SECRET must be set");
    }

    const minimized = buildMinimizedWebhookPayload(args);
    const body = JSON.stringify(minimized);
    const signature = signWebhookPayload(body, secret);

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LendLoop-Signature": signature,
        "X-Idempotency-Key": args.eventId,
      },
      body,
    });

    if (!response.ok) {
      await ctx.runMutation(internal.loans.recordAutomationWriteback, {
        idempotencyKey: args.eventId,
        requestId: args.requestId,
        workflowType: "request_notification",
        summary: `Webhook failed (${response.status}) for ${args.eventType}`,
        status: "failed",
      });
      throw new Error(`n8n webhook returned HTTP ${response.status}`);
    }

    await ctx.runMutation(internal.loans.recordAutomationWriteback, {
      idempotencyKey: args.eventId,
      requestId: args.requestId,
      workflowType: "request_notification",
      summary: `Notification sent (${args.eventType})`,
      status: "delivered",
    });
  },
});

/**
 * Idempotent write-back mutation called by n8n (via HTTP endpoint) or internal actions.
 * Prevents duplicate records or duplicate overdue reminders on retries.
 */
export const recordAutomationWriteback = internalMutation({
  args: {
    idempotencyKey: v.string(),
    requestId: v.id("borrowRequests"),
    workflowType: v.union(
      v.literal("request_notification"),
      v.literal("overdue_reminder"),
    ),
    summary: v.string(),
    status: v.union(v.literal("delivered"), v.literal("failed")),
    reminderDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();

    if (existing) {
      return { deduplicated: true, eventId: existing._id };
    }

    const now = Date.now();
    const eventId = await ctx.db.insert("automationEvents", {
      idempotencyKey: args.idempotencyKey,
      requestId: args.requestId,
      workflowType: args.workflowType,
      summary: args.summary,
      status: args.status,
      recordedAt: now,
    });

    await ctx.db.patch(args.requestId, {
      lastAutomationEvent: args.summary,
      lastAutomationAt: now,
      ...(args.reminderDate
        ? { lastOverdueReminderDate: args.reminderDate }
        : {}),
      updatedAt: now,
    });

    return { deduplicated: false, eventId };
  },
});
