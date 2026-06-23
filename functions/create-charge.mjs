// Netlify Function: cria cliente + cobrança individual no Asaas
// POST /api/create-charge
// Body: { nome, email, doc, fone, tipo, situacao, outraNome, outraDoc, objeto, valores, condicoes }

const ASAAS_URL = "https://api.asaas.com/api/v3";
const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

export default async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { status: 200, headers: CORS });
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: "API key não configurada" }), { status: 500, headers: CORS });

  const headers = { "Content-Type": "application/json", "access_token": apiKey };

  try {
    const body = await request.json();
    const { nome, email, doc, fone, tipo, situacao, outraNome, outraDoc, objeto, valores, condicoes } = body;

    const cpfCnpj = (doc || "").replace(/\D/g, "");
    const phone   = (fone || "").replace(/\D/g, "");

    // 1. Criar ou buscar cliente
    let customerId;
    const custRes = await fetch(`${ASAAS_URL}/customers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: nome, email, cpfCnpj, mobilePhone: phone, notificationDisabled: false }),
    });
    const custData = await custRes.json();

    if (custData.id) {
      customerId = custData.id;
    } else {
      // Cliente já existe — buscar por CPF/CNPJ
      const search = await fetch(`${ASAAS_URL}/customers?cpfCnpj=${cpfCnpj}`, { headers });
      const searchData = await search.json();
      customerId = searchData.data?.[0]?.id;
    }

    if (!customerId) {
      return new Response(JSON.stringify({ error: "Não foi possível criar o cliente no Asaas." }), { status: 500, headers: CORS });
    }

    // 2. Montar descrição com dados do contrato
    const desc = [
      `Contrato: ${tipo || "a definir"}`,
      situacao  ? `Situação: ${situacao}` : null,
      outraNome ? `Outra parte: ${outraNome}${outraDoc ? ` (${outraDoc})` : ""}` : null,
      objeto    ? `Objeto: ${objeto}` : null,
      valores   ? `Valores: ${valores}` : null,
      condicoes ? `Condições: ${condicoes}` : null,
    ].filter(Boolean).join(" | ");

    // 3. Data de vencimento: amanhã
    const due = new Date();
    due.setDate(due.getDate() + 1);
    const dueDate = due.toISOString().split("T")[0];

    // 4. Criar cobrança
    const payRes = await fetch(`${ASAAS_URL}/payments`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        customer: customerId,
        billingType: "UNDEFINED",
        value: 989.00,
        dueDate,
        description: desc,
        externalReference: email,
        callback: {
          successUrl: "https://contrato.souzanetoadvocacia.com.br/obrigado.html",
          autoRedirect: true,
        },
      }),
    });
    const payData = await payRes.json();

    if (!payData.id) {
      return new Response(JSON.stringify({ error: "Erro ao criar cobrança.", detail: payData }), { status: 500, headers: CORS });
    }

    return new Response(JSON.stringify({ ok: true, chargeId: payData.id, paymentUrl: payData.invoiceUrl }), { status: 200, headers: CORS });

  } catch (err) {
    console.error("create-charge error:", err);
    return new Response(JSON.stringify({ error: "Erro interno." }), { status: 500, headers: CORS });
  }
};

export const config = { path: "/api/create-charge" };
