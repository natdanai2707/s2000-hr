import { NextRequest, NextResponse } from "next/server";
import { addExpense, updateExpense } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const b = await req.json();

  // If tempId starts with existing UUID format, it's an edit
  // Otherwise it's a new entry from LINE pending
  if (b.existingId) {
    await updateExpense(b.existingId, {
      vendor: b.vendor,
      amount: parseFloat(b.amount),
      category: b.category,
      sub_category: b.sub_category || "",
      note: b.note || "",
      date: b.date,
    });
  } else {
    await addExpense({
      vendor: b.vendor,
      amount: parseFloat(b.amount),
      category: b.category,
      sub_category: b.sub_category || "",
      note: b.note || "",
      added_by: b.added_by || "LINE",
      line_user_id: b.line_user_id || "liff",
      date: b.date || new Date().toISOString().split("T")[0],
    });
  }

  return NextResponse.json({ ok: true });
}