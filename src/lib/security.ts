import { createHmac, timingSafeEqual } from "node:crypto";

export type Role = "user" | "admin";

export interface Actor {
  id: string;
  role: Role;
}

export interface ToolRecord {
  id: string;
  ownerId: string;
  name: string;
  category: string;
  condition: string;
  shortDescription: string;
  isAvailable: boolean;
}

export interface PublicToolProjection {
  id: string;
  name: string;
  category: string;
}

export interface BorrowRequestRecord {
  id: string;
  toolId: string;
  lenderId: string;
  borrowerId: string;
  startDate: string;
  endDate: string;
  status: "pending" | "approved" | "declined" | "returned";
}

/**
 * Data minimization for unauthenticated visitors:
 * Exposes ONLY id, name, and category for available tools. Strips ownerId, condition, and description.
 */
export function projectPublicTool(tool: ToolRecord): PublicToolProjection {
  return {
    id: tool.id,
    name: tool.name,
    category: tool.category,
  };
}

/**
 * Enforces RBAC for modifying or deleting a tool listing.
 * - `admin` can remove any listing.
 * - `user` can edit or delete only their own listings.
 */
export function assertCanModifyTool(
  actor: Actor,
  tool: Pick<ToolRecord, "ownerId">,
  operation: "edit" | "delete",
): void {
  if (operation === "delete" && actor.role === "admin") {
    return;
  }
  if (actor.id !== tool.ownerId) {
    throw new Error(
      `FORBIDDEN: User ${actor.id} (${actor.role}) cannot ${operation} tool owned by ${tool.ownerId}`,
    );
  }
}

/**
 * Enforces RBAC for acting on a borrow request:
 * - Only the tool's lender can approve, decline, or mark a loan as returned.
 * - A user cannot borrow their own tool.
 */
export function assertCanActOnBorrowRequest(
  actor: Actor,
  request: Pick<BorrowRequestRecord, "lenderId" | "borrowerId" | "status">,
  action: "approve" | "decline" | "mark_returned",
): void {
  if (actor.id !== request.lenderId) {
    throw new Error(
      `FORBIDDEN: Only the tool owner (${request.lenderId}) can perform ${action}`,
    );
  }
  if (
    (action === "approve" || action === "decline") &&
    request.status !== "pending"
  ) {
    throw new Error(
      `INVALID_STATE: Cannot ${action} request in status ${request.status}`,
    );
  }
  if (action === "mark_returned" && request.status !== "approved") {
    throw new Error(
      `INVALID_STATE: Only approved loans can be marked returned (current: ${request.status})`,
    );
  }
}

export function assertAdmin(actor: Actor): void {
  if (actor.role !== "admin") {
    throw new Error("FORBIDDEN: Admin role required");
  }
}

/**
 * Minimized payload sent to n8n when a borrow request is created or changes status.
 * Excludes unrelated profile fields or internal DB metadata.
 */
export function buildMinimizedWebhookPayload(params: {
  eventId: string;
  eventType: "request.created" | "request.approved" | "request.declined" | "loan.returned";
  requestId: string;
  toolName: string;
  recipientEmail: string;
  recipientRole: "lender" | "borrower";
  startDate: string;
  endDate: string;
}) {
  return {
    eventId: params.eventId,
    eventType: params.eventType,
    requestId: params.requestId,
    toolName: params.toolName,
    recipientEmail: params.recipientEmail,
    recipientRole: params.recipientRole,
    startDate: params.startDate,
    endDate: params.endDate,
  };
}

/**
 * Signs a raw JSON payload using HMAC-SHA256 with a timestamp prefix (`t.rawBody`)
 * to prevent both payload tampering and replay attacks.
 */
export function signWebhookPayload(
  rawBody: string,
  secret: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string {
  if (!secret || secret.length < 16) {
    throw new Error("Webhook HMAC secret must be at least 16 characters");
  }
  const mac = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestampSeconds},v1=${mac}`;
}

/**
 * Verifies an `x-lendloop-signature` header (`t=<ts>,v1=<hex>`) using constant-time comparison
 * and enforces a replay window (default 300 seconds).
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds: number = 300,
): boolean {
  if (!signatureHeader || !secret) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [k, v] = part.trim().split("=");
      return [k, v];
    }),
  );
  const timestamp = Number(parts.t);
  const providedHex = parts.v1;
  if (!Number.isFinite(timestamp) || typeof providedHex !== "string") {
    return false;
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }
  const expectedHex = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  const a = Buffer.from(providedHex, "hex");
  const b = Buffer.from(expectedHex, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
