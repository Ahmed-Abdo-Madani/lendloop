import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";

// Pure verification of security, data minimization, RBAC, and HMAC signing/verification invariants
function projectPublicTool(tool) {
  return {
    id: tool.id,
    name: tool.name,
    category: tool.category,
  };
}

function assertCanModifyTool(actor, tool, operation) {
  if (operation === "delete" && actor.role === "admin") return;
  if (actor.id !== tool.ownerId) {
    throw new Error(`FORBIDDEN: ${actor.id} cannot ${operation}`);
  }
}

function assertCanActOnBorrowRequest(actor, request, action) {
  if (actor.id !== request.lenderId) {
    throw new Error("FORBIDDEN: Only lender can act");
  }
  if ((action === "approve" || action === "decline") && request.status !== "pending") {
    throw new Error("INVALID_STATE");
  }
  if (action === "mark_returned" && request.status !== "approved") {
    throw new Error("INVALID_STATE");
  }
}

function signWebhookPayload(rawBody, secret, ts) {
  const mac = createHmac("sha256", secret).update(`${ts}.${rawBody}`, "utf8").digest("hex");
  return `t=${ts},v1=${mac}`;
}

function verifyWebhookSignature(rawBody, sigHeader, secret, nowTs, tolerance = 300) {
  if (!sigHeader || !secret) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.trim().split("=")));
  const ts = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(ts) || !v1 || Math.abs(nowTs - ts) > tolerance) return false;
  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`, "utf8").digest("hex");
  return expected === v1;
}

test("public tool projection strips owner details, condition, and description", () => {
  const projected = projectPublicTool({
    id: "tool_1",
    ownerId: "user_secret_123",
    ownerEmail: "private@example.com",
    name: "DeWalt Circular Saw",
    category: "power_tools",
    condition: "like_new",
    shortDescription: "Garage shelf B",
    isAvailable: true,
  });
  assert.deepEqual(projected, {
    id: "tool_1",
    name: "DeWalt Circular Saw",
    category: "power_tools",
  });
  assert.equal("ownerId" in projected, false);
  assert.equal("ownerEmail" in projected, false);
});

test("RBAC enforces user ownership on edit/delete and allows admin removal", () => {
  const tool = { ownerId: "user_alice" };
  assert.doesNotThrow(() =>
    assertCanModifyTool({ id: "user_alice", role: "user" }, tool, "edit"),
  );
  assert.throws(
    () => assertCanModifyTool({ id: "user_bob", role: "user" }, tool, "delete"),
    /FORBIDDEN/,
  );
  assert.doesNotThrow(() =>
    assertCanModifyTool({ id: "admin_1", role: "admin" }, tool, "delete"),
  );
});

test("RBAC enforces lender-only transitions on borrow requests", () => {
  const req = { lenderId: "user_alice", borrowerId: "user_bob", status: "pending" };
  assert.throws(
    () => assertCanActOnBorrowRequest({ id: "user_bob", role: "user" }, req, "approve"),
    /FORBIDDEN/,
  );
  assert.doesNotThrow(() =>
    assertCanActOnBorrowRequest({ id: "user_alice", role: "user" }, req, "approve"),
  );
  assert.throws(
    () => assertCanActOnBorrowRequest({ id: "user_alice", role: "user" }, req, "mark_returned"),
    /INVALID_STATE/,
  );
});

test("HMAC-SHA256 webhook signatures verify authentic payloads and reject tampering or replays", () => {
  const secret = "super_secret_32_byte_hmac_key_123456";
  const body = JSON.stringify({ eventId: "evt_1", eventType: "request.created" });
  const ts = 1_794_000_000;
  const sig = signWebhookPayload(body, secret, ts);

  assert.equal(verifyWebhookSignature(body, sig, secret, ts + 30), true);
  assert.equal(verifyWebhookSignature(body + "x", sig, secret, ts + 30), false);
  assert.equal(verifyWebhookSignature(body, sig, secret, ts + 600), false);
});
