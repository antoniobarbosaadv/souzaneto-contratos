// Netlify Function: recebe webhook do Asaas (confirma recebimento para não retentar)
// POST /api/webhook — configurar no Asaas: Configurações → Webhooks

export default async (request) => {
  if (request.method !== "POST") return new Response("ok", { status: 200 });
  try {
    const body = await request.json();
    console.log("Asaas webhook:", body.event, body.payment?.id, body.payment?.status);
  } catch (_) {}
  return new Response("OK", { status: 200 });
};

export const config = { path: "/api/webhook" };
