// Netlify Function: verifica status de pagamento diretamente na API do Asaas
// GET /api/check-payment?cid=CHARGE_ID

const ASAAS_URL = process.env.ASAAS_SANDBOX === "true"
  ? "https://sandbox.asaas.com/api/v3"
  : "https://api.asaas.com/api/v3";
const PAID_STATUSES = ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"];
const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store, max-age=0",
};

export default async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { status: 200, headers: CORS });

  const url = new URL(request.url);
  const cid = url.searchParams.get("cid")?.trim();

  if (!cid) return new Response(JSON.stringify({ paid: false, reason: "no charge id" }), { status: 200, headers: CORS });

  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ paid: false, reason: "no api key" }), { status: 200, headers: CORS });

  try {
    const res  = await fetch(`${ASAAS_URL}/payments/${cid}`, { headers: { "access_token": apiKey } });
    const data = await res.json();
    const paid = PAID_STATUSES.includes(data.status);
    return new Response(JSON.stringify({ paid, status: data.status ?? "unknown" }), { status: 200, headers: CORS });
  } catch (err) {
    console.error("check-payment error:", err);
    return new Response(JSON.stringify({ paid: false }), { status: 200, headers: CORS });
  }
};

export const config = { path: "/api/check-payment" };
