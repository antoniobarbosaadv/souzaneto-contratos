// ============================================================================
// Cloudflare Worker: WEBHOOK DO ASAAS  →  e-mails do fluxo de contratos
//
// Faz o mesmo que a função do Netlify, mas roda no Cloudflare (grátis, sem
// "créditos" de build). Dois fluxos:
//   • Pagamento CONFIRMADO  → e-mail com os 2 links (documentos + agendamento)
//   • Boleto GERADO (PENDENTE) → e-mail "pedido recebido / estamos processando"
//
// COMO PUBLICAR (painel do Cloudflare → Workers & Pages → Create Worker):
//   1) Cole este arquivo inteiro no editor e clique em Deploy.
//   2) Em Settings → Variables, adicione as variáveis abaixo.
//   3) Em Settings → Bindings → KV, crie/▶vincule um KV com o nome
//      CONTRACT_EMAILS (evita e-mail duplicado).
//   4) Pegue a URL do Worker (algo como
//      https://souzaneto-webhook.SEU-SUBDOMINIO.workers.dev) e aponte o
//      webhook do Asaas para ela.
//
// VARIÁVEIS (Settings → Variables and Secrets):
//   RESEND_API_KEY        (secret)  chave do Resend, começa com "re_"
//   ASAAS_API_KEY         (secret)  chave de PRODUÇÃO do Asaas (acha o e-mail do cliente)
//   ASAAS_PAYMENT_LINK_ID (texto)   ID(s) do(s) link(s) do site de contratos.
//                                   Sem ela, nada é enviado. Vários: separe por vírgula.
//   MAIL_FROM             (texto, opcional) remetente verificado no Resend.
//                         Padrão: "Souza Neto Advocacia <contato@souzanetoadvocacia.com.br>"
//   MAIL_BCC              (texto, opcional) cópia oculta de cada e-mail
//   ASAAS_WEBHOOK_TOKEN   (secret, opcional) se definido, exige o mesmo token no Asaas
//   ADS_HOOK_URL          (texto, opcional) URL do conector (Make/Zapier) p/ Google Ads
//
// BINDING KV:
//   CONTRACT_EMAILS       (KV Namespace) — dedup de e-mails já enviados
// ============================================================================

const ASAAS_URL = "https://api.asaas.com/api/v3";
const PAID_STATUSES = ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"];

const LINK_DOCUMENTOS  = "https://tally.so/r/zxgAgM";
const LINK_AGENDAMENTO = "https://cal.read.ai/contratos-sn/30-min";

function mailFrom(env) {
  return env.MAIL_FROM || "Souza Neto Advocacia <contato@souzanetoadvocacia.com.br>";
}

// ---------------- Dedup via Cloudflare KV ----------------
// kind: "sent" = e-mail com os links (pago) · "ack" = aviso de pedido recebido (boleto)
async function alreadySent(env, paymentId, kind) {
  if (!env.CONTRACT_EMAILS) return false; // KV não vinculado → segue (fail-open)
  try { return !!(await env.CONTRACT_EMAILS.get(`${kind}:${paymentId}`)); }
  catch (e) { console.warn("KV get falhou:", e && e.message); return false; }
}
async function markSent(env, paymentId, kind) {
  if (!env.CONTRACT_EMAILS) return;
  try { await env.CONTRACT_EMAILS.put(`${kind}:${paymentId}`, new Date().toISOString()); }
  catch (e) { console.warn("KV put falhou:", e && e.message); }
}

// ---------------- Cliente (e-mail/nome) no Asaas ----------------
async function getCustomer(payment, env) {
  let email = payment && payment.customerEmail ? payment.customerEmail : null;
  let name  = payment && payment.customerName  ? payment.customerName  : null;

  const extRef = (payment && payment.externalReference) || "";
  if (!email && /@/.test(extRef)) email = extRef;

  const customerId = typeof (payment && payment.customer) === "string"
    ? payment.customer
    : (payment && payment.customer && payment.customer.id);

  if ((!email || !name) && customerId && env.ASAAS_API_KEY) {
    try {
      const res = await fetch(`${ASAAS_URL}/customers/${customerId}`, {
        headers: { "access_token": env.ASAAS_API_KEY },
      });
      const data = await res.json();
      email = email || (data && data.email);
      name  = name  || (data && data.name);
    } catch (e) {
      console.warn("Falha ao buscar cliente no Asaas:", e && e.message);
    }
  }
  return { email, name };
}

// ---------------- Templates ----------------
function buildLinksEmail(name) {
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

function buildOrderReceivedEmail(name) {
  const ola = name ? `Olá, ${name.split(" ")[0]}!` : "Olá!";
  const text =
`${ola}

Recebemos o seu pedido de contrato — obrigado!

Seu pagamento está sendo processado. Assim que ele for confirmado, você receberá um e-mail com as orientações dos próximos passos: o envio dos documentos e o agendamento da reunião com o advogado.

Pagamentos por boleto podem levar de 1 a 3 dias úteis para compensar. Você não precisa fazer mais nada agora além de concluir o pagamento.

Qualquer dúvida, é só responder este e-mail ou escrever para contato@souzanetoadvocacia.com.br.

Souza Neto Advocacia`;

  const html = `<!DOCTYPE html><html lang="pt-BR"><body style="margin:0;background:#0e1c2e;font-family:Arial,Helvetica,sans-serif;color:#f6f4ef">
  <div style="max-width:560px;margin:0 auto;padding:36px 28px">
    <p style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#c2a26a;font-weight:bold;margin:0 0 18px">Pedido recebido</p>
    <h1 style="font-size:26px;color:#ffffff;margin:0 0 14px">${ola} Recebemos o seu pedido.</h1>
    <p style="font-size:15px;line-height:1.6;color:#c5cdd8;margin:0 0 18px">Seu pagamento está sendo processado. <strong style="color:#f6f4ef">Assim que ele for confirmado</strong>, você receberá um e-mail com as orientações dos próximos passos — o envio dos documentos e o agendamento da sua reunião com o advogado.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px">
      <tr><td style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:20px 24px">
        <p style="font-size:14px;line-height:1.6;color:#c5cdd8;margin:0">Pagamentos por <strong style="color:#f6f4ef">boleto</strong> podem levar de 1 a 3 dias úteis para compensar. Você não precisa fazer mais nada agora além de concluir o pagamento.</p>
      </td></tr>
    </table>
    <p style="font-size:13px;line-height:1.6;color:#8a8270;margin:0">Dúvidas? Responda este e-mail ou escreva para <a href="mailto:contato@souzanetoadvocacia.com.br" style="color:#c2a26a">contato@souzanetoadvocacia.com.br</a>.</p>
    <p style="font-size:12px;color:#5a6472;margin:22px 0 0">© Souza Neto Sociedade Individual de Advocacia · OAB/MS 22.741</p>
  </div></body></html>`;
  return { text, html };
}

// ---------------- Envio via Resend ----------------
async function resendSend(env, { to, subject, text, html }) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY não configurada");
  const payload = { from: mailFrom(env), to: [to], subject, text, html };
  if (env.MAIL_BCC) payload.bcc = [env.MAIL_BCC];

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const out = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${out.slice(0, 300)}`);
  console.log("E-mail enviado para", to, "→", out.slice(0, 120));
}

// ---------------- Repasse pro Google Ads (opcional) ----------------
async function forwardToAds(env, { email, name, value, paymentId, event }) {
  if (!env.ADS_HOOK_URL) return;
  try {
    const res = await fetch(env.ADS_HOOK_URL, {
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
    console.warn("Falha ao repassar conversão (ignorado):", e && e.message);
  }
}

// ---------------- Handler ----------------
export default {
  async fetch(request, env) {
    // Health check / acesso direto no navegador
    if (request.method !== "POST") return new Response("ok", { status: 200 });

    // Segurança opcional: token do webhook
    if (env.ASAAS_WEBHOOK_TOKEN) {
      const got = request.headers.get("asaas-access-token");
      if (got !== env.ASAAS_WEBHOOK_TOKEN) {
        console.warn("Webhook recusado: token inválido");
        return new Response("forbidden", { status: 401 });
      }
    }

    let body;
    try { body = await request.json(); }
    catch (_) { return new Response("ok", { status: 200 }); }

    const event   = body && body.event;
    const payment = body && body.payment;
    console.log("Asaas webhook:", event, payment && payment.id, payment && payment.status, payment && payment.billingType);

    if (!payment || !payment.id) return new Response("ignored", { status: 200 });

    // FILTRO DE ORIGEM — só pagamentos vindos do(s) link(s) do site de contratos.
    const allowedLinks = (env.ASAAS_PAYMENT_LINK_ID || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (allowedLinks.length === 0) {
      console.warn("ASAAS_PAYMENT_LINK_ID não configurado — nada enviado.");
      return new Response("no-source-filter", { status: 200 });
    }
    if (!allowedLinks.includes(payment.paymentLink)) {
      console.log("Outra origem, ignorado. paymentLink =", payment.paymentLink);
      return new Response("ignored-source", { status: 200 });
    }

    const isPaid = PAID_STATUSES.includes(payment.status)
      || ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_RECEIVED_IN_CASH"].includes(event);

    const isBoletoPending = !isPaid
      && payment.billingType === "BOLETO"
      && (event === "PAYMENT_CREATED" || payment.status === "PENDING");

    // Fluxo 1: pago → e-mail com os 2 links
    if (isPaid) {
      if (await alreadySent(env, payment.id, "sent")) {
        return new Response("already-sent", { status: 200 });
      }
      const { email, name } = await getCustomer(payment, env);
      if (!email) {
        console.error("Sem e-mail do cliente para", payment.id);
        return new Response("no-email", { status: 200 });
      }
      try {
        const { text, html } = buildLinksEmail(name);
        await resendSend(env, {
          to: email,
          subject: "Pagamento confirmado — seus próximos passos (documentos + agendamento)",
          text, html,
        });
      } catch (e) {
        console.error("Falha ao enviar e-mail dos links:", e && e.message);
        return new Response("send-failed", { status: 500 });
      }
      await markSent(env, payment.id, "sent");
      await forwardToAds(env, { email, name, value: payment.value, paymentId: payment.id, event });
      return new Response("OK", { status: 200 });
    }

    // Fluxo 2: boleto gerado → e-mail "pedido recebido"
    if (isBoletoPending) {
      if (await alreadySent(env, payment.id, "ack")) {
        return new Response("already-acked", { status: 200 });
      }
      const { email, name } = await getCustomer(payment, env);
      if (!email) {
        console.error("Sem e-mail do cliente (pedido recebido) para", payment.id);
        return new Response("no-email", { status: 200 });
      }
      try {
        const { text, html } = buildOrderReceivedEmail(name);
        await resendSend(env, {
          to: email,
          subject: "Recebemos seu pedido — estamos processando seu pagamento",
          text, html,
        });
      } catch (e) {
        console.error("Falha ao enviar e-mail de pedido recebido:", e && e.message);
        return new Response("send-failed", { status: 500 });
      }
      await markSent(env, payment.id, "ack");
      return new Response("OK", { status: 200 });
    }

    return new Response("ignored", { status: 200 });
  },
};
