"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireOwnerAction } from "@/lib/auth";
import { FILTER_COOKIE, parseFilters } from "@/lib/board";

/** CC-15 AC2: remember the filter choice for the browser session (session cookie, no expiry). */
export async function applyFilters(formData: FormData): Promise<void> {
  if (!(await requireOwnerAction())) redirect("/login"); // CC-01: every action checks the session
  const f = parseFilters(Object.fromEntries(formData.entries()));
  const jar = await cookies();
  jar.set(FILTER_COOKIE, JSON.stringify(f), { httpOnly: true, sameSite: "strict", path: "/" });
  redirect("/");
}

export async function resetFilters(): Promise<void> {
  if (!(await requireOwnerAction())) redirect("/login");
  const jar = await cookies();
  jar.delete(FILTER_COOKIE);
  redirect("/");
}
