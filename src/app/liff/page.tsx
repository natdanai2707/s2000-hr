"use client";
import { useEffect, useState } from "react";

const CATS = [
  { id: "personal",    label: "ส่วนตัว" },
  { id: "with_layers", label: "WITH LAYERS" },
  { id: "met",         label: "MET Furniture" },
  { id: "steel_s2000", label: "S-2000" },
  { id: "south_steel", label: "เหล็กใต้" },
  { id: "other",       label: "อื่นๆ" },
];

const PERSONAL_SUBS = [
  "ค่าอาหาร","อาหารนอกบ้าน/คาเฟ่","ค่าที่พัก/สาธารณูปโภค",
  "ค่าเดินทาง","ค่ารักษาพยาบาล","ช้อปปิ้ง","สันทนาการ",
  "ท่องเที่ยว","ของขวัญ","การออม/ลงทุน","อื่นๆ",
];

export default function LiffPage() {
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    tempId: "",
    vendor: "",
    amount: "",
    date: new Date().toISOString().split("T")[0],
    category: "personal",
    sub_category: "อื่นๆ",
    note: "",
  });

  useEffect(() => {
    // Parse params from URL
    const params = new URLSearchParams(window.location.search);
    setForm(prev => ({
      ...prev,
      tempId:       params.get("id") || "",
      vendor:       params.get("vendor") || "",
      amount:       params.get("amount") || "",
      date:         params.get("date") || new Date().toISOString().split("T")[0],
      category:     params.get("category") || "personal",
      sub_category: params.get("sub_category") || "อื่นๆ",
      note:         params.get("note") || "",
    }));

    // Init LIFF
    const initLiff = async () => {
      try {
        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID! });
        if (!liff.isLoggedIn()) liff.login();
        setReady(true);
      } catch (e) {
        console.error(e);
        setReady(true); // show form anyway
      }
    };
    initLiff();
  }, []);

  const handleSubmit = async () => {
    if (!form.vendor || !form.amount) return;
    setSaving(true);
    try {
      await fetch("/api/liff-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setDone(true);
      // Close LIFF after 1.5s
      setTimeout(async () => {
        try {
          const liff = (await import("@line/liff")).default;
          liff.closeWindow();
        } catch {}
      }, 1500);
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  };

  const inp = (label: string, key: string, type = "text", ph = "") => (
    <div style={{ marginBottom: 16 }}>
      <label style={styles.label}>{label}</label>
      <input
        type={type} placeholder={ph}
        value={(form as any)[key]}
        onChange={e => setForm({ ...form, [key]: e.target.value })}
        style={styles.input}
      />
    </div>
  );

  if (!ready) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#f8f8f8" }}>
      <div style={{ color: "#6b7280", fontSize: 14 }}>กำลังโหลด...</div>
    </div>
  );

  if (done) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#f8f8f8", gap: 12 }}>
      <div style={{ fontSize: 48 }}>✅</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#111" }}>บันทึกแล้ว!</div>
      <div style={{ fontSize: 14, color: "#6b7280" }}>กำลังปิดหน้าต่าง...</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", fontFamily: "'IBM Plex Sans Thai', Sarabun, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#6366f1", padding: "18px 20px", color: "white" }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>แก้ไขรายการ</div>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>ตรวจสอบและแก้ไขข้อมูลก่อนบันทึก</div>
      </div>

      <div style={{ padding: "20px 20px 100px" }}>
        {inp("ร้านค้า / Vendor *", "vendor", "text", "ชื่อร้าน...")}
        {inp("จำนวนเงิน (THB) *", "amount", "number", "0")}
        {inp("วันที่", "date", "date")}
        {inp("หมายเหตุ", "note", "text", "รายละเอียดเพิ่มเติม...")}

        <div style={{ marginBottom: 16 }}>
          <label style={styles.label}>หมวดหมู่</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {CATS.map(cat => (
              <button key={cat.id}
                onClick={() => setForm({ ...form, category: cat.id, sub_category: cat.id === "personal" ? "อื่นๆ" : "" })}
                style={{
                  padding: "8px 14px", borderRadius: 20, border: "2px solid",
                  fontSize: 13, fontWeight: 500, background: "white",
                  borderColor: form.category === cat.id ? "#6366f1" : "#e5e7eb",
                  color: form.category === cat.id ? "#6366f1" : "#6b7280",
                }}>
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {form.category === "personal" && (
          <div style={{ marginBottom: 16 }}>
            <label style={styles.label}>หมวดย่อย</label>
            <select value={form.sub_category}
              onChange={e => setForm({ ...form, sub_category: e.target.value })}
              style={{ ...styles.input, background: "white" }}>
              {PERSONAL_SUBS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Fixed bottom bar */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "16px 20px", background: "white", borderTop: "1px solid #e5e7eb", display: "flex", gap: 10 }}>
        <button
          onClick={async () => { try { const liff = (await import("@line/liff")).default; liff.closeWindow(); } catch {} }}
          style={{ flex: 1, padding: 14, borderRadius: 12, border: "1px solid #e5e7eb", background: "white", color: "#6b7280", fontSize: 15, fontWeight: 500 }}>
          ปิด
        </button>
        <button onClick={handleSubmit} disabled={saving || !form.vendor || !form.amount}
          style={{ flex: 2, padding: 14, borderRadius: 12, border: "none", background: saving ? "#9ca3af" : "#6366f1", color: "white", fontSize: 15, fontWeight: 700 }}>
          {saving ? "กำลังบันทึก..." : "บันทึก →"}
        </button>
      </div>
    </div>
  );
}

const styles = {
  label: { fontSize: 13, color: "#374151", display: "block" as const, marginBottom: 6, fontWeight: 500 },
  input: { width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 15, outline: "none", boxSizing: "border-box" as const, background: "white", color: "#111" },
};