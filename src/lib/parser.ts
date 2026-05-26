import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, type CategoryId } from "./supabase";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ParsedExpense {
  vendor: string;
  amount: number;
  category: CategoryId;
  sub_category: string;
  note: string;
  date?: string;
}

const SUB_CAT_KEYWORDS: Record<string, string[]> = {
  "ค่าอาหาร":              ["ข้าว", "อาหาร", "นม", "ขนม", "7-11", "เซเว่น", "ผัก", "เนื้อ", "น้ำ"],
  "อาหารนอกบ้าน/คาเฟ่":   ["กาแฟ", "คาเฟ่", "ร้านอาหาร", "ชาบู", "บุฟเฟ่", "sushi", "ซูชิ", "บาบีคิว", "away"],
  "ค่าที่พัก/สาธารณูปโภค": ["เช่าบ้าน", "ค่าเช่า", "ค่าไฟ", "ค่าน้ำ", "internet", "subscription", "ส่วนกลาง"],
  "ค่าเดินทาง":            ["น้ำมัน", "grab", "bts", "mrt", "จอดรถ", "taxi", "เติมรถ"],
  "ค่ารักษาพยาบาล":        ["หมอ", "ยา", "โรงพยาบาล", "clinic"],
  "ช้อปปิ้ง":              ["shopee", "lazada", "รองเท้า", "เสื้อผ้า", "กระเป๋า"],
  "สันทนาการ":             ["บอล", "ปีนผา", "โค้ช", "นวด", "หนัง", "gym"],
  "ท่องเที่ยว":            ["ตั๋ว", "โรงแรม", "hotel", "ทริป", "เที่ยว"],
  "ของขวัญ":               ["ของขวัญ", "เลี้ยง", "gift"],
  "การออม/ลงทุน":          ["ออม", "kept", "ลงทุน", "หุ้น", "กองทุน"],
};

const CAT_KEYWORDS: Record<CategoryId, string[]> = {
  personal:    ["ส่วนตัว", "personal"],
  with_layers: ["with layers", "withlayers", "wl", "layers", "kerry", "j&t", "flash", "ไปรษณีย์", "แพ็ค", "ปากกา", "refill"],
  met:         ["met", "เฟอร์นิเจอร์", "furniture", "สแตนเลส", "อลูมิเนียม"],
  steel_s2000: ["s-2000", "s2000", "เบิก s2000"],
  south_steel: ["เหล็กใต้", "south steel", "southsteel"],
  other:       [],
};

function detectSubCategory(text: string): string {
  const lower = text.toLowerCase();
  for (const [sub, keywords] of Object.entries(SUB_CAT_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return sub;
  }
  return "อื่นๆ";
}

export function parseTextExpense(text: string): ParsedExpense | null {
  const amountMatch = text.match(/(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:บาท|thb|฿)?/i);
  if (!amountMatch) return null;
  const amount = parseFloat(amountMatch[1].replace(/,/g, ""));
  if (amount <= 0) return null;

  const lower = text.toLowerCase();
  let category: CategoryId = "personal";
  for (const [cat, keywords] of Object.entries(CAT_KEYWORDS) as [CategoryId, string[]][]) {
    if (cat === "personal" || cat === "other") continue;
    if (keywords.some(kw => lower.includes(kw))) { category = cat; break; }
  }

  const sub_category = category === "personal" ? detectSubCategory(text) : "";
  const vendor = text
    .replace(/\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:บาท|thb|฿)?/gi, "")
    .replace(/ส่วนตัว|personal|with layers|withlayers|เหล็กใต้|s-2000|s2000/gi, "")
    .replace(/\s+/g, " ").trim() || "ไม่ระบุ";

  return { vendor, amount, category, sub_category, note: text };
}

export async function ocrReceiptImage(imageBase64: string, mediaType: string): Promise<ParsedExpense | null> {
  try {
    const res = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as any, data: imageBase64 } },
          { type: "text", text: `วิเคราะห์ใบเสร็จในรูป ตอบเป็น JSON เท่านั้น:
{"vendor":"ชื่อร้าน","amount":0,"date":"YYYY-MM-DD หรือ null","note":"รายละเอียดสั้นๆ","category":"personal/with_layers/met/steel_s2000/south_steel/other","sub_category":"ค่าอาหาร/อาหารนอกบ้าน-คาเฟ่/ค่าที่พัก-สาธารณูปโภค/ค่าเดินทาง/ค่ารักษาพยาบาล/ช้อปปิ้ง/สันทนาการ/ท่องเที่ยว/ของขวัญ/การออม-ลงทุน/อื่นๆ"}` },
        ],
      }],
    });

    const txt = res.content[0].type === "text" ? res.content[0].text : "";
    const match = txt.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const p = JSON.parse(match[0]);
    return {
      vendor: p.vendor || "ไม่ระบุ",
      amount: parseFloat(p.amount) || 0,
      date: p.date || undefined,
      note: p.note || "",
      category: (p.category as CategoryId) || "personal",
      sub_category: p.sub_category || "อื่นๆ",
    };
  } catch (e) {
    console.error("OCR error:", e);
    return null;
  }
}

const CAT_LABELS: Record<string, string> = {
  personal: "ส่วนตัว", with_layers: "WITH LAYERS", met: "MET",
  steel_s2000: "S-2000", south_steel: "เหล็กใต้", other: "อื่นๆ",
};

export function buildFlexMessage(item: any, tempId: string) {
  const catLabel = CAT_LABELS[item.category] || "อื่นๆ";
  const liffUrl = `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}?id=${tempId}&vendor=${encodeURIComponent(item.vendor)}&amount=${item.amount}&date=${item.date || ""}&category=${item.category}&sub_category=${encodeURIComponent(item.sub_category || "")}&note=${encodeURIComponent(item.note || "")}&added_by=${encodeURIComponent(item.added_by || "")}&line_user_id=${item.line_user_id || ""}`;

  return {
    type: "flex",
    altText: `${item.vendor} ${Number(item.amount).toLocaleString("th-TH")} บาท`,
    contents: {
      type: "bubble",
      styles: { body: { backgroundColor: "#ffffff" }, footer: { backgroundColor: "#f9fafb" } },
      body: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "20px",
        contents: [
          { type: "text", text: item.vendor, weight: "bold", size: "xl", color: "#111111" },
          { type: "text", text: `${Number(item.amount).toLocaleString("th-TH")} บาท`, size: "xxl", weight: "bold", color: "#6366f1", margin: "xs" },
          { type: "separator", margin: "lg" },
          {
            type: "box", layout: "vertical", margin: "lg", spacing: "sm",
            contents: [
              row("หมวด", catLabel),
              ...(item.sub_category ? [row("หมวดย่อย", item.sub_category)] : []),
              ...(item.date ? [row("วันที่", item.date)] : []),
            ],
          },
        ],
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
        contents: [
          {
            type: "box", layout: "horizontal", spacing: "sm",
            contents: [
              {
                type: "button", style: "secondary", flex: 1, height: "sm",
                action: { type: "postback", label: "ยกเลิก", data: `action=cancel&id=${tempId}`, displayText: "ยกเลิก" },
              },
              {
                type: "button", style: "primary", flex: 2, height: "sm", color: "#6366f1",
                action: { type: "postback", label: "ยืนยัน", data: `action=save&id=${tempId}`, displayText: "ยืนยันบันทึก" },
              },
            ],
          },
          {
            type: "button", style: "secondary", height: "sm",
            action: { type: "uri", label: "แก้ไขในฟอร์ม", uri: liffUrl },
          },
        ],
      },
    },
  };
}

function row(label: string, value: string) {
  return {
    type: "box", layout: "horizontal",
    contents: [
      { type: "text", text: label, size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: value, size: "sm", color: "#111111", flex: 3, weight: "bold", wrap: true },
    ],
  };
}

export function buildReportText(summary: any): string {
  const lines = [`สรุปค่าใช้จ่าย`, `รวม ${summary.total.toLocaleString("th-TH")} บาท (${summary.count} รายการ)\n`];
  for (const [, d] of Object.entries(summary.byCategory) as any) {
    if (d.count > 0) {
      lines.push(`${d.label}: ${d.total.toLocaleString("th-TH")} บาท`);
      if (d.bySubCategory) {
        for (const [sub, amt] of Object.entries(d.bySubCategory) as any) {
          lines.push(`  · ${sub}: ${amt.toLocaleString("th-TH")} บาท`);
        }
      }
    }
  }
  lines.push(`\n${process.env.NEXT_PUBLIC_APP_URL}`);
  return lines.join("\n");
}