import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const toolCategoryValidator = v.union(
  v.literal("power_tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("automotive"),
  v.literal("other"),
);

export const toolConditionValidator = v.union(
  v.literal("like_new"),
  v.literal("good"),
  v.literal("fair"),
);

export const userRoleValidator = v.union(
  v.literal("user"),
  v.literal("admin"),
);

export const loanStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("returned"),
);

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    displayName: v.string(),
    role: userRoleValidator,
    isTrustedLender: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_role", ["role"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: toolCategoryValidator,
    condition: toolConditionValidator,
    shortDescription: v.string(),
    isAvailable: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"])
    .index("by_availability", ["isAvailable"]),

  borrowRequests: defineTable({
    toolId: v.id("tools"),
    lenderId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // ISO YYYY-MM-DD
    endDate: v.string(), // ISO YYYY-MM-DD
    status: loanStatusValidator,
    lastAutomationEvent: v.optional(v.string()),
    lastAutomationAt: v.optional(v.number()),
    lastOverdueReminderDate: v.optional(v.string()), // YYYY-MM-DD for daily idempotency
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tool", ["toolId"])
    .index("by_lender", ["lenderId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_status", ["status"]),

  automationEvents: defineTable({
    idempotencyKey: v.string(),
    requestId: v.id("borrowRequests"),
    workflowType: v.union(
      v.literal("request_notification"),
      v.literal("overdue_reminder"),
    ),
    summary: v.string(),
    status: v.union(v.literal("delivered"), v.literal("failed")),
    recordedAt: v.number(),
  })
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_request", ["requestId"]),
});
