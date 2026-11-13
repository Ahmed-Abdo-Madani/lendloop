"use client";

import React, { useState } from "react";
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

const CATEGORIES = [
  { value: "all", label: "All Categories" },
  { value: "power_tools", label: "Power Tools" },
  { value: "garden", label: "Garden" },
  { value: "kitchen", label: "Kitchen" },
  { value: "camping", label: "Camping" },
  { value: "automotive", label: "Automotive" },
  { value: "other", label: "Other" },
] as const;

function formatRelativeAutomation(text?: string | null, ts?: number | null) {
  if (!text) return "No recent automation activity";
  if (!ts) return text;
  const days = Math.max(0, Math.floor((Date.now() - ts) / 86_400_000));
  const suffix = days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
  return `${text} (${suffix})`;
}

export default function LendLoopBoardPage() {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<
    "browse" | "my_listings" | "my_requests" | "incoming_requests" | "admin"
  >("browse");

  // Public query (returns ONLY name & category — zero owner details)
  const publicTools = useQuery(api.tools.listPublicAvailableTools) ?? [];

  // Authenticated queries & mutations
  const authenticatedTools =
    useQuery(api.tools.listAuthenticatedTools, {
      category:
        selectedCategory === "all" ? undefined : (selectedCategory as any),
    }) ?? [];
  const myRequests =
    useQuery(api.loans.listScopedLoans, { scope: "my_requests" }) ?? [];
  const incomingRequests =
    useQuery(api.loans.listScopedLoans, { scope: "incoming_requests" }) ?? [];

  const createTool = useMutation(api.tools.createTool);
  const removeTool = useMutation(api.tools.removeTool);
  const requestToBorrow = useMutation(api.loans.requestToBorrow);
  const updateBorrowStatus = useMutation(api.loans.updateBorrowRequestStatus);
  const setTrustedLender = useMutation(api.tools.setTrustedLender);

  const [newTool, setNewTool] = useState({
    name: "",
    category: "power_tools",
    condition: "good",
    shortDescription: "",
  });

  const [borrowDates, setBorrowDates] = useState({
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            LendLoop
          </h1>
          <p className="mt-1 text-base text-slate-600">
            Borrow what you need. Lend what you don&apos;t.
          </p>
        </div>

        <div>
          <SignedOut>
            <SignInButton mode="modal">
              <button className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800">
                Sign in to lend or borrow
              </button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <div className="flex items-center gap-3">
              <UserButton afterSignOutUrl="/" />
            </div>
          </SignedIn>
        </div>
      </header>

      {/* PUBLIC VIEW: Read-only list of available tools (name & category ONLY, no owner details) */}
      <SignedOut>
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              Available Tools in Your Neighborhood
            </h2>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              Data-minimized public view (no owner PII exposed)
            </span>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {publicTools.map((tool: any) => (
              <div
                key={tool._id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <span className="inline-block rounded bg-slate-100 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-slate-700">
                  {String(tool.category).replace("_", " ")}
                </span>
                <h3 className="mt-2 text-base font-semibold text-slate-900">
                  {tool.name}
                </h3>
              </div>
            ))}
          </div>
        </section>
      </SignedOut>

      {/* AUTHENTICATED EXPERIENCE */}
      <SignedIn>
        <nav className="mt-6 flex flex-wrap gap-2 border-b border-slate-200 pb-4">
          {[
            { id: "browse", label: "All Tools" },
            { id: "my_listings", label: "My Listings & List a Tool" },
            { id: "my_requests", label: "My Requests" },
            { id: "incoming_requests", label: "Incoming Requests" },
            { id: "admin", label: "Admin Moderation" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${
                activeTab === tab.id
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === "browse" && (
          <section className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-700">
                  Category:
                </label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <span>Borrow dates:</span>
                <input
                  type="date"
                  value={borrowDates.startDate}
                  onChange={(e) =>
                    setBorrowDates((d) => ({ ...d, startDate: e.target.value }))
                  }
                  className="rounded border border-slate-300 px-2 py-1"
                />
                <span>to</span>
                <input
                  type="date"
                  value={borrowDates.endDate}
                  onChange={(e) =>
                    setBorrowDates((d) => ({ ...d, endDate: e.target.value }))
                  }
                  className="rounded border border-slate-300 px-2 py-1"
                />
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {authenticatedTools.map((tool: any) => (
                <div
                  key={tool._id}
                  className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="rounded bg-slate-100 px-2.5 py-0.5 text-xs font-medium uppercase text-slate-700">
                        {String(tool.category).replace("_", " ")} ·{" "}
                        {String(tool.condition).replace("_", " ")}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          tool.isAvailable
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {tool.isAvailable ? "Available" : "On Loan"}
                      </span>
                    </div>
                    <h3 className="mt-2 text-lg font-semibold text-slate-900">
                      {tool.name}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {tool.shortDescription}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      Lender: {tool.ownerName}{" "}
                      {tool.ownerIsTrustedLender && (
                        <span className="ml-1 rounded bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">
                          ✓ Trusted Lender
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <button
                      disabled={!tool.isAvailable}
                      onClick={() =>
                        requestToBorrow({
                          toolId: tool._id,
                          startDate: borrowDates.startDate,
                          endDate: borrowDates.endDate,
                        })
                      }
                      className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      Request to Borrow
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "my_listings" && (
          <section className="mt-6 space-y-6">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await createTool(newTool as any);
                setNewTool({
                  name: "",
                  category: "power_tools",
                  condition: "good",
                  shortDescription: "",
                });
              }}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <h2 className="text-base font-semibold text-slate-900">
                List a Tool to Lend
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <input
                  required
                  placeholder="Tool name (e.g. Bosch Cordless Drill)"
                  value={newTool.name}
                  onChange={(e) =>
                    setNewTool((t) => ({ ...t, name: e.target.value }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <select
                  value={newTool.category}
                  onChange={(e) =>
                    setNewTool((t) => ({ ...t, category: e.target.value }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {CATEGORIES.filter((c) => c.value !== "all").map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <select
                  value={newTool.condition}
                  onChange={(e) =>
                    setNewTool((t) => ({ ...t, condition: e.target.value }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="like_new">Like New</option>
                  <option value="good">Good</option>
                  <option value="fair">Fair</option>
                </select>
              </div>
              <textarea
                required
                placeholder="Short description & safety notes"
                value={newTool.shortDescription}
                onChange={(e) =>
                  setNewTool((t) => ({
                    ...t,
                    shortDescription: e.target.value,
                  }))
                }
                className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                Publish Listing
              </button>
            </form>
          </section>
        )}

        {(activeTab === "my_requests" || activeTab === "incoming_requests") && (
          <section className="mt-6 space-y-3">
            {(activeTab === "my_requests" ? myRequests : incomingRequests).map(
              (loan: any) => (
                <div
                  key={loan._id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div>
                    <h3 className="font-semibold text-slate-900">
                      {loan.toolName}{" "}
                      <span className="text-xs font-normal text-slate-500">
                        ({loan.startDate} → {loan.endDate})
                      </span>
                    </h3>
                    <p className="text-xs text-slate-600">
                      Status: <strong className="uppercase">{loan.status}</strong>{" "}
                      · Lender: {loan.lenderName} · Borrower: {loan.borrowerName}
                    </p>
                    <p className="mt-1 text-xs text-indigo-700">
                      ⚡ Automation:{" "}
                      {formatRelativeAutomation(
                        loan.lastAutomationEvent,
                        loan.lastAutomationAt,
                      )}
                    </p>
                  </div>

                  {activeTab === "incoming_requests" && (
                    <div className="flex items-center gap-2">
                      {loan.status === "pending" && (
                        <>
                          <button
                            onClick={() =>
                              updateBorrowStatus({
                                requestId: loan._id,
                                action: "approve",
                              })
                            }
                            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() =>
                              updateBorrowStatus({
                                requestId: loan._id,
                                action: "decline",
                              })
                            }
                            className="rounded bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white"
                          >
                            Decline
                          </button>
                        </>
                      )}
                      {loan.status === "approved" && (
                        <button
                          onClick={() =>
                            updateBorrowStatus({
                              requestId: loan._id,
                              action: "mark_returned",
                            })
                          }
                          className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          Mark as Returned
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ),
            )}
          </section>
        )}

        {activeTab === "admin" && (
          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">
              Admin Controls (Convex-Enforced RBAC)
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Admins can remove any listing, view all neighborhood loans, and
              mark lenders as Trusted Lenders. All checks are enforced inside
              Convex mutations/queries.
            </p>
            <div className="mt-4 space-y-2">
              {authenticatedTools.map((tool: any) => (
                <div
                  key={tool._id}
                  className="flex items-center justify-between border-b border-slate-100 py-2 text-sm"
                >
                  <span>
                    <strong>{tool.name}</strong> — Owner: {tool.ownerName}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        setTrustedLender({
                          targetUserId: tool.ownerId,
                          isTrustedLender: !tool.ownerIsTrustedLender,
                        })
                      }
                      className="rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                    >
                      {tool.ownerIsTrustedLender
                        ? "Revoke Trusted Lender"
                        : "Mark Trusted Lender"}
                    </button>
                    <button
                      onClick={() => removeTool({ toolId: tool._id })}
                      className="rounded border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700"
                    >
                      Remove Listing
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </SignedIn>
    </div>
  );
}
