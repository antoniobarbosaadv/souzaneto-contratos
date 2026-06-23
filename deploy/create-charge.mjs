// Netlify Function: cria cliente + cobrança individual no Asaas
// POST /api/create-charge

const ASAAS_URL = process.env.ASAAS_SANDBOX === "true"
  ? "https://sandbox.asaas.com/api/v3"
  : "https://api.asaas.com/api/v3";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

async function asaas(method, path, body, apiKey) {
  const res = await fetch(`${ASAAS_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "access_token": apiKey },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  console.log(`Asaas ${method} ${path} → ${res.status}:`, text.slice(0, 300));
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch (_) { return { status: res.status, data: null, raw: text }; }
}

export default async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { status: 200, headers: CORS });
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: "API key não configurada" }), { status: 500, headers: CORS });

  let body;
  try { body = await request.json(); }
  catch (_) { return new Response(JSON.stringify({ error: "Body inválido" }), { status: 400, headers: CORS }); }

  const { nome, email, doc, fone, tipo, situacao, outraNome, outraDoc, objeto, valores, condicoes } = body;
  const cpfCnpj = (doc || "").replace(/\D/g, "");
  const phone   = (fone || "").replace(/\D/g, "");

  try {
    // 1. Criar cliente
    let customerId;
    const cust = await asaas("POST", "/customers", {
      name: nome || "Cliente", email, cpfCnpj, mobilePhone: phone, notificationDisabled: false
    }, apiKey);

    if (cust.data?.id) {
      customerId = cust.data.id;
    } else if (cpfCnpj) {
      // Cliente já existe — buscar por CPF/CNPJ
      const search = await asaas("GET", `/customers?cpfCnpj=${cpfCnpj}`, null, apiKey);
      customerId = search.data?.data?.[0]?.id;
    }

    if (!customerId) {
      return new Response(JSON.stringify({ error: "Não foi possível criar o cliente no Asaas.", detail: cust.raw || cust.data }), { status: 500, headers: CORS });
    }

    // 2. Descrição
    const desc = [
      `Contrato: ${tipo || "a definir"}`,
      situacao  ? `Situação: ${situacao}` : null,
      outraNome ? `Outra parte: ${outraNome}${outraDoc ? ` (${outraDoc})` : ""}` : null,
      objeto    ? `Objeto: ${objeto}` : null,
      valores   ? `Valores: ${valores}` : null,
      condicoes ? `Condições: ${condicoes}` : null,
    ].filter(Boolean).join(" | ");

    // 3. Vencimento: amanhã
    const due = new Date();
    due.setDate(due.getDate() + 1);
    const dueDate = due.toISOString().split("T")[0];

    // 4. Criar cobrança
    const pay = await asaas("POST", "/payments", {
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
    }, apiKey);

    if (!pay.data?.id) {
      return new Response(JSON.stringify({ error: "Erro ao criar cobrança.", detail: pay.raw || pay.data }), { status: 500, headers: CORS });
    }

    return new Response(JSON.stringify({ ok: true, chargeId: pay.data.id, paymentUrl: pay.data.invoiceUrl }), { status: 200, headers: CORS });

  } catch (err) {
    console.error("create-charge error:", err);
    return new Response(JSON.stringify({ error: "Erro interno.", detail: err.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: "/api/create-charge" };
