"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FILTER_COOKIE, parseFilters } from "@/lib/board";

/** CC-15 AC2: remember the filter choice for the browser session (session cookie, no expiry). */
export async function applyFilters(formData: FormData): Promise<void> {
  const f = parseFilters(Object.fromEntries(formData.entries()));
  const jar = await cookies();
  jar.set(FILTER_COOKIE, JSON.stringify(f), { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}

export async function resetFilters(): Promise<void> {
  const jar = await cookies();
  jar.delete(FILTER_COOKIE);
  redirect("/");
}
