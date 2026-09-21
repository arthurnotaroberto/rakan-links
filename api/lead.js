// Função serverless (Vercel, Node) — captura de lead do raio-x financeiro.
// Envia 2 e-mails via SMTP do Google Workspace (nodemailer):
//   1) para o LEAD: seu resultado formatado + próximos passos + WhatsApp
//   2) para o ARTHUR: notificação "Novo lead do raio-x"
// v1: NÃO grava em banco, só envia e-mail. NÃO coleta CPF (minimização/LGPD).
//
// Env vars necessárias (setar na Vercel, projeto rakan-links):
//   SMTP_USER  -> mailbox remetente (ex.: sistema@rakan-invest.com)
//   SMTP_PASS  -> senha de APP do Google (NÃO a senha normal da conta)
//   SMTP_HOST  -> opcional, default smtp.gmail.com
//   SMTP_PORT  -> opcional, default 587 (STARTTLS). Use 465 para SSL.

const nodemailer = require('nodemailer');

const ARTHUR_EMAIL = 'arthur.notaroberto@rakan-invest.com';
const WHATSAPP_URL = 'https://wa.me/5511981940543';

// ===== Rate-limit simples por IP (memória do processo; best-effort em serverless) =====
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 min
const RATE_MAX = 5;                     // 5 envios por IP na janela
const hits = new Map();                 // ip -> [timestamps]

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  // limpeza oportunista
  if (hits.size > 500) {
    for (const [k, v] of hits) {
      if (!v.some(t => now - t < RATE_WINDOW_MS)) hits.delete(k);
    }
  }
  return arr.length > RATE_MAX;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const isEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

// ===== Encaminha o lead para o Funil do app principal (opcional/configurável) =====
// Só dispara se APP_LEAD_INTAKE_URL e APP_LEAD_INTAKE_TOKEN existirem. Nunca lança:
// e-mail é o caminho principal; falha aqui não pode quebrar o envio nem a resposta.
async function forwardToApp({ nome, email, whatsapp, etapa, respostas }) {
  const url = process.env.APP_LEAD_INTAKE_URL;
  const token = process.env.APP_LEAD_INTAKE_TOKEN;
  if (!url || !token) return; // endpoint ainda não existe/configurado -> pula em silêncio
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ nome, email, whatsapp, etapa, respostas, source: 'checklist' }),
      signal: ctrl.signal
    });
    clearTimeout(t);
  } catch (err) {
    console.error('Falha ao encaminhar lead ao app (ignorado):', err && err.message ? err.message : err);
  }
}

// ===== E-mail HTML para o LEAD (estilo café com leite) =====
function buildLeadHtml({ nome, etapa, ondeAgir, jaFunciona }) {
  const acoes = (ondeAgir || []).map(a => `
    <div style="background:#FAF6EE;border-radius:12px;padding:14px 16px;margin-bottom:9px;">
      <div style="font-size:14px;font-weight:600;color:#2A2520;margin-bottom:4px;line-height:1.3;">${esc(a.pergunta)}</div>
      <div style="font-size:13px;color:#5A5249;line-height:1.45;">${esc(a.acao)}</div>
    </div>`).join('') ||
    `<div style="font-size:13px;color:#8B7E70;font-style:italic;">Nada pendente. Você respondeu sim em tudo. Parabéns!</div>`;

  const funciona = (jaFunciona || []).map(t => `
    <div style="background:#FAF6EE;border-radius:12px;padding:12px 16px;margin-bottom:8px;font-size:13px;font-weight:600;color:#2A2520;">
      <span style="color:#6B7F4A;font-weight:700;">&#10003;</span> ${esc(t)}
    </div>`).join('') ||
    `<div style="font-size:13px;color:#8B7E70;font-style:italic;">Tudo bem começar do zero. O primeiro passo você já deu: este raio-x.</div>`;

  return `<!DOCTYPE html>
<html lang="pt-br"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#1B1713;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:28px 18px;">
    <div style="text-align:center;margin-bottom:22px;">
      <div style="font-size:12px;color:#C9A875;letter-spacing:0.16em;text-transform:uppercase;font-weight:600;margin-bottom:8px;">Seu raio-x financeiro</div>
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:600;color:#F5EFE6;">Olá, ${esc(nome || 'tudo bem')}!</div>
    </div>

    <div style="background:#FAF6EE;border-radius:18px;padding:24px 22px;">
      <p style="font-size:14px;color:#5A5249;line-height:1.55;margin:0 0 18px;">
        Você fez o raio-x da sua vida financeira. Pelo que respondeu, sua etapa atual é:
      </p>
      <div style="text-align:center;background:linear-gradient(135deg,#C9A875,#A0522D);border-radius:14px;padding:18px;margin-bottom:24px;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:600;color:#FFFFFF;">${esc(etapa)}</div>
      </div>

      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;color:#A0522D;margin-bottom:12px;">&rarr; Onde agir agora</div>
      ${acoes}

      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;color:#6B7F4A;margin:22px 0 12px;">&#10003; O que já funciona</div>
      ${funciona}

      <div style="text-align:center;margin-top:26px;">
        <a href="${WHATSAPP_URL}" style="display:inline-block;background:#C9A875;color:#2A2520;text-decoration:none;font-weight:700;font-size:15px;padding:14px 30px;border-radius:100px;">Falar com o Arthur no WhatsApp</a>
      </div>
    </div>

    <div style="text-align:center;margin-top:22px;">
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#F5EFE6;margin-bottom:4px;">Arthur Notaroberto · Rakan | Vida Única</div>
      <div style="font-size:11px;color:#8B7E70;">Viva bem hoje sem comprometer o amanhã.</div>
    </div>
  </div>
</body></html>`;
}

// ===== E-mail para o ARTHUR (notificação de novo lead) =====
function buildArthurHtml({ nome, email, whatsapp, etapa, respostas }) {
  const linhas = (respostas || []).map(r => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;color:#2A2520;">${esc(r.pergunta)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;font-weight:700;color:${r.resposta === 'Sim' ? '#6B7F4A' : '#A0522D'};">${esc(r.resposta)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="pt-br"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:20px;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#2A2520;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;">
    <h2 style="font-family:Georgia,serif;color:#A0522D;margin:0 0 16px;">Novo lead do raio-x</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr><td style="padding:6px 0;font-size:14px;"><strong>Nome:</strong></td><td style="padding:6px 0;font-size:14px;">${esc(nome)}</td></tr>
      <tr><td style="padding:6px 0;font-size:14px;"><strong>E-mail:</strong></td><td style="padding:6px 0;font-size:14px;"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
      <tr><td style="padding:6px 0;font-size:14px;"><strong>WhatsApp:</strong></td><td style="padding:6px 0;font-size:14px;">${esc(whatsapp) || '—'}</td></tr>
      <tr><td style="padding:6px 0;font-size:14px;"><strong>Etapa:</strong></td><td style="padding:6px 0;font-size:14px;"><strong>${esc(etapa)}</strong></td></tr>
    </table>
    <h3 style="font-size:14px;color:#5A5249;margin:0 0 8px;">Respostas (13)</h3>
    <table style="width:100%;border-collapse:collapse;">${linhas}</table>
  </div>
</body></html>`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Método não permitido.' });
    return;
  }

  // Body pode vir já parseado (Vercel) ou como string
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const nome = (body.nome || '').toString().trim();
  const email = (body.email || '').toString().trim();
  const whatsapp = (body.whatsapp || '').toString().trim();
  const consent = body.consent === true;
  const honeypot = (body.website || '').toString().trim();

  // Honeypot: se preenchido, é bot. Fingimos sucesso e ignoramos.
  if (honeypot) { res.status(200).json({ ok: true }); return; }

  // Validação server-side
  if (!nome) { res.status(400).json({ ok: false, error: 'Informe seu nome.' }); return; }
  if (!isEmail(email)) { res.status(400).json({ ok: false, error: 'E-mail inválido.' }); return; }
  if (!consent) { res.status(400).json({ ok: false, error: 'É preciso aceitar o contato para receber o resultado.' }); return; }

  // Rate-limit por IP
  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
    return;
  }

  // Credenciais SMTP
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  if (!SMTP_USER || !SMTP_PASS) {
    console.error('SMTP_USER/SMTP_PASS ausentes nas env vars.');
    res.status(500).json({ ok: false, error: 'Envio de e-mail ainda não está configurado. Fale com o Arthur pelo WhatsApp.' });
    return;
  }

  const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
  const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);

  const respostas = Array.isArray(body.respostas) ? body.respostas : [];
  const ondeAgir = Array.isArray(body.ondeAgir) ? body.ondeAgir : [];
  const jaFunciona = Array.isArray(body.jaFunciona) ? body.jaFunciona : [];
  const etapa = (body.etapa || '').toString();

  const from = `"Arthur Notaroberto" <${SMTP_USER}>`;

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // 465 = SSL; 587 = STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

    // 1) E-mail para o LEAD (resultado)
    await transporter.sendMail({
      from,
      to: email,
      replyTo: ARTHUR_EMAIL,
      subject: `Seu raio-x financeiro: etapa ${etapa}`,
      html: buildLeadHtml({ nome, etapa, ondeAgir, jaFunciona })
    });

    // 2) E-mail para o ARTHUR (notificação)
    await transporter.sendMail({
      from,
      to: ARTHUR_EMAIL,
      replyTo: email,
      subject: `Novo lead do raio-x: ${nome} (${etapa})`,
      html: buildArthurHtml({ nome, email, whatsapp, etapa, respostas })
    });

    // Encaminha ao Funil do app (opcional; nunca quebra o fluxo do e-mail)
    await forwardToApp({ nome, email, whatsapp, etapa, respostas });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Falha no envio de e-mail:', err && err.message ? err.message : err);
    res.status(502).json({ ok: false, error: 'Não consegui enviar agora. Tente de novo em instantes.' });
  }
};
