// ============================================================================
// Netlify Function: WEBHOOK DO ASAAS  →  envia e-mail com os 2 links
// POST /api/webhook
//
// O QUE FAZ:
//   Quando o Asaas confirma um pagamento (cartão/Pix na hora, boleto em 1-3
//   dias), o Asaas chama esta função. Ela envia ao cliente um e-mail com:
//     • Documentos  → formulário Tally
//     • Agendamento → Read.ai
//
//   É a peça que substitui os links que antes apareciam na página de obrigado.
//
// COMO LIGAR (painel do Asaas → Configurações → Integrações → Webhooks):
//   URL:    https://contrato.souzanetoadvocacia.com.br/api/webhook
//   Eventos: PAYMENT_CONFIRMED e PAYMENT_RECEIVED  (pode marcar todos; o resto
//            é ignorado aqui)
//   Token:  (opcional, recomendado) defina um texto secreto e coloque também
//            na variável de ambiente ASAAS_WEBHOOK_TOKEN abaixo.
//
// VARIÁVEIS DE AMBIENTE (Netlify → Site settings → Environment variables):
//   ASAAS_API_KEY        (JÁ EXISTE — usada pelas outras funções)
//   RESEND_API_KEY       (NOVA — sua chave do Resend, começa com "re_")
//   MAIL_FROM            (opcional) remetente verificado no Resend.
//                        Padrão: "Souza Neto Advocacia <contato@souzanetoadvocacia.com.br>"
//   MAIL_BCC             (opcional) cópia oculta p/ você receber aviso de cada venda
//   ASAAS_WEBHOOK_TOKEN  (opcional) mesmo token configurado no webhook do Asaas
//   ADS_HOOK_URL         (opcional) URL do "catch hook" do conector (Zapier/Make)
//                        que registra a conversão no Google Ads. Quando definida,
//                        esta função repassa { email, value } ao conector assim
//                        que o pagamento confirma — conversão só de venda paga.
// ============================================================================

const ASAAS_URL = "https://api.asaas.com/api/v3";

// Status que significam "pago" — só estes disparam o e-mail.
const PAID_STATUSES = ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"];

// Os 2 links que o cliente precisa receber.
const LINK_DOCUMENTOS  = "https://tally.so/r/zxgAgM";
const LINK_AGENDAMENTO = "https://cal.read.ai/contratos-sn/30-min";

const MAIL_FROM = process.env.MAIL_FROM
  || "Souza Neto Advocacia <contato@souzanetoadvocacia.com.br>";

// ---------------------------------------------------------------------------
// Garante que cada pagamento gere NO MÁXIMO 1 e-mail, mesmo que o Asaas mande
// vários eventos (ex.: cartão dispara CONFIRMED agora e RECEIVED na liquidação).
// Usa o armazenamento nativo do Netlify (Blobs). Se por algum motivo o Blobs
// não estiver disponível, a função NÃO trava: ela segue e envia o e-mail
// (é melhor um raro e-mail repetido do que o cliente ficar sem as orientações).
// ---------------------------------------------------------------------------
async function alreadyEmailed(paymentId) {
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("contract-emails");
    const seen = await store.get(`sent:${paymentId}`);
    return { seen: !!seen, store };
  } catch (e) {
    console.warn("Blobs indisponível (seguindo sem dedup):", e?.message);
    return { seen: false, store: null };
  }
}

async function markEmailed(store, paymentId) {
  if (!store) return;
  try { await store.set(`sent:${paymentId}`, new Date().toISOString()); }
  catch (e) { console.warn("Falha ao marcar e-mail enviado:", e?.message); }
}

// Busca e-mail e nome do cliente no Asaas (funciona mesmo no link fixo,
// onde o pagamento não traz o e-mail direto no corpo do webhook).
async function getCustomer(payment, apiKey) {
  // 1) tentativa direta: alguns eventos já trazem dados expandidos
  let email = payment?.customerEmail || null;
  let name  = payment?.customerName  || null;

  // 2) externalReference às vezes é o e-mail (fluxo via create-charge)
  if (!email && /@/.test(payment?.externalReference || "")) {
    email = payment.externalReference;
  }

  // 3) busca pelo ID do cliente
  const customerId = typeof payment?.customer === "string"
    ? payment.customer
    : payment?.customer?.id;

  if ((!email || !name) && customerId && apiKey) {
    try {
      const res = await fetch(`${ASAAS_URL}/customers/${customerId}`, {
        headers: { "access_token": apiKey },
      });
      const data = await res.json();
      email = email || data?.email;
      name  = name  || data?.name;
    } catch (e) {
      console.warn("Falha ao buscar cliente no Asaas:", e?.message);
    }
  }

  return { email, name };
}

function buildEmail(name) {
  const ola = name ? `Olá, ${name.split(" ")[0]}!` : "Olá!";
  const text =
`${ola}

Seu pagamento foi confirmado — obrigado! Para o advogado chegar à reunião com tudo em mãos, faltam só 2 passos rápidos:

1) Envie suas informações e documentos:
   ${LINK_DOCUMENTOS}

2) Agende sua reunião com o advogado:
   ${LINK_AGENDAMENTO}

Você tem até 15 dias para enviar tudo. Não tem todos os documentos agora? Sem problema, é só voltar pelo mesmo link e enviar quando tiver.

Qualquer dúvida, é só responder este e-mail ou escrever para contato@souzanetoadvocacia.com.br.

Souza Neto Advocacia`;

  const html = `<!DOCTYPE html><html lang="pt-BR"><body style="margin:0;background:#0e1c2e;font-family:Arial,Helvetica,sans-serif;color:#f6f4ef">
  <div style="max-width:560px;margin:0 auto;padding:36px 28px">
    <p style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#c2a26a;font-weight:bold;margin:0 0 18px">Pagamento confirmado</p>
    <h1 style="font-size:26px;color:#ffffff;margin:0 0 14px">${ola} Faltam só 2 passos.</h1>
    <p style="font-size:15px;line-height:1.6;color:#c5cdd8;margin:0 0 26px">Seu pagamento foi confirmado — obrigado! Para o advogado chegar à reunião com tudo em mãos, conclua os dois passos abaixo. Leva poucos minutos.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px">
      <tr><td style="background:rgba(194,162,106,0.10);border:1px solid rgba(194,162,106,0.35);border-radius:10px;padding:22px 24px">
        <div style="font-size:13px;color:#c2a26a;font-weight:bold;margin-bottom:6px">PASSO 1 · Documentos</div>
        <div style="font-size:14px;line-height:1.6;color:#c5cdd8;margin-bottom:16px">Preencha o formulário com os dados do contrato e anexe os documentos (RG, CPF, matrícula, etc.).</div>
        <a href="${LINK_DOCUMENTOS}" style="display:inline-block;background:#c2a26a;color:#0e1c2e;text-decoration:none;font-size:14px;font-weight:bold;padding:13px 22px;border-radius:5px">Enviar documentos →</a>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 26px">
      <tr><td style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:22px 24px">
        <div style="font-size:13px;color:#c2a26a;font-weight:bold;margin-bottom:6px">PASSO 2 · Agendamento</div>
        <div style="font-size:14px;line-height:1.6;color:#c5cdd8;margin-bottom:16px">Escolha o melhor horário para conversar com o advogado (até 30 min, por vídeo).</div>
        <a href="${LINK_AGENDAMENTO}" style="display:inline-block;border:1px solid #c2a26a;color:#c2a26a;text-decoration:none;font-size:14px;font-weight:bold;padding:13px 22px;border-radius:5px">Escolher horário →</a>
      </td></tr>
    </table>

    <p style="font-size:13px;line-height:1.6;color:#8a8270;margin:0">Você tem até <strong style="color:#aeb8c4">15 dias</strong> para enviar tudo. Dúvidas? Responda este e-mail ou escreva para <a href="mailto:contato@souzanetoadvocacia.com.br" style="color:#c2a26a">contato@souzanetoadvocacia.com.br</a>.</p>
    <p style="font-size:12px;color:#5a6472;margin:22px 0 0">© Souza Neto Sociedade Individual de Advocacia · OAB/MS 22.741</p>
  </div></body></html>`;

  return { text, html };
}

async function sendEmail(to, name) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY não configurada");

  const { text, html } = buildEmail(name);
  const payload = {
    from: MAIL_FROM,
    to: [to],
    subject: "Pagamento confirmado — seus próximos passos (documentos + agendamento)",
    text,
    html,
  };
  if (process.env.MAIL_BCC) payload.bcc = [process.env.MAIL_BCC];

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const out = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${out.slice(0, 300)}`);
  console.log("E-mail enviado para", to, "→", out.slice(0, 120));
}

// Repassa a venda confirmada para o conector (Zapier/Make), que registra a
// conversão no Google Ads usando o e-mail do cliente (Enhanced Conversions for
// Leads). Best-effort: se falhar, apenas registra no log — não afeta o e-mail
// nem faz o Asaas retentar (a conversão não deve bloquear a orientação ao cliente).
async function forwardToAds({ email, name, value, paymentId, event }) {
  const url = process.env.ADS_HOOK_URL;
  if (!url) return; // conector ainda não configurado
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        name: name || "",
        value: typeof value === "number" ? value : Number(value) || 0,
        currency: "BRL",
        conversion: "compra_989",
        order_id: paymentId,
        event,
      }),
    });
    console.log("Ads hook →", res.status);
  } catch (e) {
    console.warn("Falha ao repassar conversão ao conector (ignorado):", e?.message);
  }
}

export default async (request) => {
  if (request.method !== "POST") return new Response("ok", { status: 200 });

  // Segurança opcional: se você definir ASAAS_WEBHOOK_TOKEN, exigimos que o
  // Asaas envie o mesmo token (evita que terceiros disparem e-mails).
  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  if (expected) {
    const got = request.headers.get("asaas-access-token");
    if (got !== expected) {
      console.warn("Webhook recusado: token inválido");
      return new Response("forbidden", { status: 401 });
    }
  }

  let body;
  try { body = await request.json(); }
  catch (_) { return new Response("ok", { status: 200 }); }

  const event   = body?.event;
  const payment = body?.payment;
  console.log("Asaas webhook:", event, payment?.id, payment?.status, payment?.billingType);

  // Só seguimos quando o pagamento está efetivamente pago.
  const isPaid = PAID_STATUSES.includes(payment?.status)
    || ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_RECEIVED_IN_CASH"].includes(event);
  if (!payment?.id || !isPaid) {
    return new Response("ignored", { status: 200 });
  }

  // Evita e-mail duplicado para o mesmo pagamento.
  const { seen, store } = await alreadyEmailed(payment.id);
  if (seen) {
    console.log("Já enviado antes, ignorando:", payment.id);
    return new Response("already-sent", { status: 200 });
  }

  // Descobre o e-mail do cliente.
  const apiKey = process.env.ASAAS_API_KEY;
  const { email, name } = await getCustomer(payment, apiKey);
  if (!email) {
    console.error("Sem e-mail do cliente para o pagamento", payment.id);
    // Retorna 200 para o Asaas não ficar retentando algo que não vai mudar.
    return new Response("no-email", { status: 200 });
  }

  // Envia. Se falhar, retornamos 5xx para o Asaas RETENTAR mais tarde
  // (e não marcamos como enviado, então a retentativa tentará de novo).
  try {
    await sendEmail(email, name);
  } catch (e) {
    console.error("Falha ao enviar e-mail:", e?.message);
    return new Response("send-failed", { status: 500 });
  }

  await markEmailed(store, payment.id);

  // Registra a conversão paga no Google Ads (via conector), se configurado.
  await forwardToAds({
    email,
    name,
    value: payment?.value,
    paymentId: payment.id,
    event,
  });

  return new Response("OK", { status: 200 });
};

export const config = { path: "/api/webhook" };
