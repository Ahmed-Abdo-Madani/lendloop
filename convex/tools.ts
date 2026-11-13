import { v } from "convex/values";
import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { toolCategoryValidator, toolConditionValidator } from "./schema";

async function requireAuthenticatedUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("UNAUTHENTICATED: Sign in with Clerk to access this resource");
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
 * PUBLIC QUERY: Returns ONLY available tools with `name` and `category` (zero owner PII).
 */
export const listPublicAvailableTools = query({
  args: {},
  handler: async (ctx) => {
    const available = await ctx.db
      .query("tools")
      .withIndex("by_availability", (q) => q.eq("isAvailable", true))
      .collect();

    return available.map((tool) => ({
      _id: tool._id,
      name: tool.name,
      category: tool.category,
    }));
  },
});

/**
 * AUTHENTICATED QUERY: Returns all tools with availability, owner display name,
 * and Trusted Lender badge, optionally filtered by category.
 */
export const listAuthenticatedTools = query({
  args: {
    category: v.optional(toolCategoryValidator),
  },
  handler: async (ctx, args) => {
    await requireAuthenticatedUser(ctx);

    const tools = args.category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", args.category!))
          .collect()
      : await ctx.db.query("tools").collect();

    return Promise.all(
      tools.map(async (tool) => {
        const owner = await ctx.db.get(tool.ownerId);
        return {
          _id: tool._id,
          ownerId: tool.ownerId,
          ownerName: owner?.displayName ?? "Neighbor",
          ownerIsTrustedLender: owner?.isTrustedLender ?? false,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          shortDescription: tool.shortDescription,
          isAvailable: tool.isAvailable,
        };
      }),
    );
  },
});

/**
 * AUTHENTICATED MUTATION: Create a new tool listing owned by the signed-in user.
 */
export const createTool = mutation({
  args: {
    name: v.string(),
    category: toolCategoryValidator,
    condition: toolConditionValidator,
    shortDescription: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const name = args.name.trim();
    const shortDescription = args.shortDescription.trim();
    if (!name || name.length > 120) {
      throw new Error("VALIDATION_ERROR: Tool name must be 1–120 characters");
    }
    if (!shortDescription || shortDescription.length > 500) {
      throw new Error("VALIDATION_ERROR: Short description must be 1–500 characters");
    }

    const now = Date.now();
    return ctx.db.insert("tools", {
      ownerId: user._id,
      name,
      category: args.category,
      condition: args.condition,
      shortDescription,
      isAvailable: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * AUTHENTICATED MUTATION: Update a tool listing.
 * Enforces RBAC in Convex: Only the listing owner can edit their own tool.
 */
export const updateTool = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category: toolCategoryValidator,
    condition: toolConditionValidator,
    shortDescription: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) throw new Error("NOT_FOUND: Tool listing does not exist");

    if (tool.ownerId !== user._id) {
      throw new Error("FORBIDDEN: Users can only edit their own tool listings");
    }

    await ctx.db.patch(args.toolId, {
      name: args.name.trim(),
      category: args.category,
      condition: args.condition,
      shortDescription: args.shortDescription.trim(),
      updatedAt: Date.now(),
    });
  },
});

/**
 * AUTHENTICATED MUTATION: Remove a tool listing.
 * Enforces RBAC in Convex:
 * - `user` can delete ONLY their own listing.
 * - `admin` can remove ANY listing.
 */
export const removeTool = mutation({
  args: {
    toolId: v.id("tools"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) throw new Error("NOT_FOUND: Tool listing does not exist");

    if (user.role !== "admin" && tool.ownerId !== user._id) {
      throw new Error("FORBIDDEN: Only the owner or an admin can remove this listing");
    }

    await ctx.db.delete(args.toolId);
  },
});

/**
 * ADMIN-ONLY MUTATION: Mark or unmark a lender as "Trusted Lender".
 */
export const setTrustedLender = mutation({
  args: {
    targetUserId: v.id("users"),
    isTrustedLender: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await requireAuthenticatedUser(ctx);
    if (actor.role !== "admin") {
      throw new Error("FORBIDDEN: Only admins can mark a lender as Trusted Lender");
    }
    await ctx.db.patch(args.targetUserId, {
      isTrustedLender: args.isTrustedLender,
    });
  },
});
