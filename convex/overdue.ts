import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/**
 * Internal query used by /api/overdue-loans to return ONLY minimized fields
 * for approved loans whose endDate is strictly before `today` and have not yet
 * received an overdue reminder for `today`.
 */
export const listOverdueForDate = internalQuery({
  args: {
    today: v.string(),
  },
  handler: async (ctx, args) => {
    const approvedLoans = await ctx.db
      .query("borrowRequests")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();

    const overdue = approvedLoans.filter(
      (loan) =>
        loan.endDate < args.today && loan.lastOverdueReminderDate !== args.today,
    );

    return Promise.all(
      overdue.map(async (loan) => {
        const [tool, borrower] = await Promise.all([
          ctx.db.get(loan.toolId),
          ctx.db.get(loan.borrowerId),
        ]);
        return {
          requestId: loan._id,
          idempotencyKey: `overdue_${loan._id}_${args.today}`,
          toolName: tool?.name ?? "Tool",
          borrowerEmail: borrower?.email ?? "",
          endDate: loan.endDate,
        };
      }),
    );
  },
});
