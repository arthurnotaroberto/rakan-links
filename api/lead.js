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

// Formata número em Real. dec = casas decimais (0 por padrão; 2 para aportes mensais).
function brl(v, dec) {
  const n = Number(v);
  const casas = dec || 0;
  if (!isFinite(n)) return 'R$ 0';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: casas, maximumFractionDigits: casas });
}
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

// Rótulos amigáveis dos simuladores
const SIM_LABELS = {
  objetivo: 'Conquista de objetivos',
  independencia: 'Independência financeira',
  aposentadoria: 'Independência financeira', // compat: alias antigo
  reserva: 'Reserva de emergência',
  juros: 'Juros compostos'
};

// ===== Encaminha o lead para o Funil do app principal (opcional/configurável) =====
// Só dispara se APP_LEAD_INTAKE_URL e APP_LEAD_INTAKE_TOKEN existirem. Nunca lança:
// e-mail é o caminho principal; falha aqui não pode quebrar o envio nem a resposta.
// Recebe o payload já pronto (deve incluir `source`); envia como está.
async function forwardToApp(payload) {
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
      body: JSON.stringify(payload),
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

// ===== Conteúdo do mini plano por simulador (linguagem plana, sem slogan) =====
// Recebe os inputs (dados) e os números calculados (resultado) vindos do cliente.
function simuladorConteudo(simulador, dados, resultado, objetivoTipo) {
  dados = dados || {};
  resultado = resultado || {};
  objetivoTipo = (objetivoTipo || '').toString().trim();
  const d = (k) => num(dados[k]);
  const r = (k) => num(resultado[k]);
  let headline = '', passos = [], resumo = [];

  // "independencia" (novo) e "aposentadoria" (alias antigo) usam o mesmo cálculo/plano
  const isIndep = (simulador === 'aposentadoria' || simulador === 'independencia');

  if (simulador === 'objetivo') {
    // Personaliza pelo objetivo escolhido, quando informado ("a viagem", "o intercâmbio"...)
    const alvo = objetivoTipo || 'o seu objetivo';
    resumo = [
      ['Objetivo', brl(d('valor'))],
      ['Prazo', d('meses') + ' meses'],
      ['Já tem pra ele', brl(d('tem'))],
      ['Rendimento considerado', d('taxaAA') + '% a.a.']
    ];
    if (resultado.atingido) {
      headline = 'Seu plano pra ' + alvo + ': só com o que você já tem rendendo, você alcança ' + brl(d('valor')) + ' no prazo. Não precisa guardar mais.';
      passos = [
        'Mantenha o dinheiro rendendo onde está e não mexa antes da hora.',
        'Revise daqui a alguns meses pra confirmar que segue no rumo.'
      ];
    } else {
      headline = 'Seu plano pra ' + alvo + ': guarde ' + brl(r('aporteMensal'), 2) + ' por mês pra juntar ' + brl(d('valor')) + ' em ' + d('meses') + ' meses.';
      resumo.push(['Guardar por mês', brl(r('aporteMensal'), 2)]);
      passos = [
        'Abra uma conta de investimento numa corretora, se ainda não tem. Leva poucos minutos e não custa nada.',
        'Automatize um aporte de ' + brl(r('aporteMensal'), 2) + ' todo mês, logo depois de receber — antes de gastar.',
        'Pra prazo curto (até ~2 anos), deixe em algo seguro e de resgate rápido, como Tesouro Selic ou CDB de liquidez diária.'
      ];
    }
  } else if (isIndep) {
    resumo = [
      ['Renda desejada', brl(d('renda')) + '/mês'],
      ['Patrimônio-alvo', brl(r('patrimonioAlvo'))],
      ['Prazo', d('anos') + ' anos'],
      ['Já investido', brl(d('tem'))],
      ['Rendimento considerado', d('taxaAA') + '% a.a.']
    ];
    if (resultado.atingido) {
      headline = 'Só com o que você já tem investido rendendo, você chega ao patrimônio de ' + brl(r('patrimonioAlvo')) + ' — que gera cerca de ' + brl(d('renda')) + '/mês — dentro do prazo.';
      passos = [
        'Mantenha os aportes e o dinheiro rendendo; não interrompa sem necessidade.',
        'Diversifique conforme o patrimônio cresce (renda fixa, ações, fundos imobiliários e internacional).',
        'Revise uma vez por ano — objetivos e cenário mudam.'
      ];
    } else {
      headline = 'Pra ter ' + brl(d('renda')) + '/mês sem depender do trabalho, você precisa de ' + brl(r('patrimonioAlvo')) + ' de patrimônio. Guardando ' + brl(r('aporteMensal'), 2) + ' por mês por ' + d('anos') + ' anos, você chega lá.';
      resumo.push(['Guardar por mês', brl(r('aporteMensal'), 2)]);
      passos = [
        'Coloque o aporte de ' + brl(r('aporteMensal'), 2) + ' como prioridade no orçamento, não como a sobra do mês.',
        'Automatize esse aporte pra ele acontecer sozinho, todo mês.',
        'Diversifique conforme o valor cresce: renda fixa, ações, fundos imobiliários e um pedaço internacional.',
        'Revise uma vez por ano e ajuste o aporte se a sua renda mudar.'
      ];
    }
  } else if (simulador === 'reserva') {
    const cobertoStr = num(resultado.mesesCobertos).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    resumo = [
      ['Gasto mensal', brl(d('gasto'))],
      ['Meta (' + d('meses') + ' meses)', brl(r('meta'))],
      ['Já guardado', brl(d('guardado'))],
      ['Coberto hoje', cobertoStr + ' meses']
    ];
    if (resultado.completa) {
      headline = 'Sua reserva já cobre ' + cobertoStr + ' meses — está completa. Próximo passo: fazer esse dinheiro render.';
      passos = [
        'Deixe a reserva numa conta separada, segura e de resgate imediato (Tesouro Selic ou CDB de liquidez diária).',
        'Com a base protegida, comece a investir o excedente pensando em objetivos de médio e longo prazo.'
      ];
    } else {
      headline = 'Hoje você está coberto por ' + cobertoStr + ' meses. Pra chegar em ' + d('meses') + ' meses (' + brl(r('meta')) + '), faltam ' + brl(r('falta')) + '.';
      resumo.push(['Falta guardar', brl(r('falta'))]);
      passos = [
        'Abra uma conta separada só pra reserva — não misture com o dinheiro do dia a dia.',
        'Deixe em algo seguro e de resgate imediato: Tesouro Selic ou CDB de liquidez diária.',
        'Guarde um valor fixo todo mês até fechar os ' + brl(r('falta')) + ' que faltam.'
      ];
    }
  } else { // juros
    resumo = [
      ['Valor inicial', brl(d('inicial'))],
      ['Aporte mensal', brl(d('aporte'), 2)],
      ['Prazo', d('anos') + ' anos'],
      ['Rendimento considerado', d('taxaAA') + '% a.a.'],
      ['Total no fim', brl(r('valorFinal'))],
      ['Sendo de juros', brl(r('juros'))]
    ];
    headline = 'Em ' + d('anos') + ' anos você teria ' + brl(r('valorFinal')) + '. Você colocou ' + brl(r('aportado')) + '; os juros trabalharam ' + brl(r('juros')) + ' pra você.';
    passos = [
      'Comece agora, mesmo que com pouco — o que faz os juros crescerem é o tempo.',
      'Automatize o aporte de ' + brl(d('aporte'), 2) + ' por mês pra ele não depender de disciplina.',
      'Adiar alguns anos custa caro no final: quanto mais cedo, mais forte o efeito.'
    ];
  }
  return { headline, passos, resumo };
}

// ===== E-mail HTML para o LEAD (mini plano personalizado, estilo café com leite) =====
function buildSimuladorLeadHtml({ nome, simulador, dados, resultado, objetivoTipo }) {
  const { headline, passos, resumo } = simuladorConteudo(simulador, dados, resultado, objetivoTipo);
  const label = SIM_LABELS[simulador] || 'Simulador';

  const passosHtml = passos.map((p, idx) => `
    <div style="margin-bottom:9px;">
      <table role="presentation" style="border-collapse:collapse;"><tr>
        <td style="vertical-align:top;padding-right:12px;">
          <div style="width:24px;height:24px;border-radius:50%;background:#A0522D;color:#FFFFFF;font-size:13px;font-weight:700;text-align:center;line-height:24px;">${idx + 1}</div>
        </td>
        <td style="font-size:13px;color:#5A5249;line-height:1.5;">${esc(p)}</td>
      </tr></table>
    </div>`).join('');

  const resumoHtml = (resumo || []).map(([k, v]) => `
    <tr>
      <td style="padding:7px 0;border-bottom:1px solid #EFE7DA;font-size:13px;color:#5A5249;">${esc(k)}</td>
      <td style="padding:7px 0;border-bottom:1px solid #EFE7DA;font-size:13px;font-weight:700;color:#2A2520;text-align:right;">${esc(v)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="pt-br"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#1B1713;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:28px 18px;">
    <div style="text-align:center;margin-bottom:22px;">
      <div style="font-size:12px;color:#C9A875;letter-spacing:0.16em;text-transform:uppercase;font-weight:600;margin-bottom:8px;">Seu plano · ${esc(label)}</div>
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:600;color:#F5EFE6;">Olá, ${esc(nome || 'tudo bem')}!</div>
    </div>

    <div style="background:#FAF6EE;border-radius:18px;padding:24px 22px;">
      <div style="text-align:center;background:linear-gradient(135deg,#C9A875,#A0522D);border-radius:14px;padding:18px;margin-bottom:22px;">
        <div style="font-size:15px;font-weight:600;color:#FFFFFF;line-height:1.45;">${esc(headline)}</div>
      </div>

      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;color:#8B7E70;margin-bottom:10px;">Seus números</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">${resumoHtml}</table>

      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;color:#A0522D;margin-bottom:12px;">&rarr; Próximos passos</div>
      ${passosHtml}

      <div style="text-align:center;margin-top:26px;">
        <a href="${WHATSAPP_URL}" style="display:inline-block;background:#C9A875;color:#2A2520;text-decoration:none;font-weight:700;font-size:15px;padding:14px 30px;border-radius:100px;">Falar com o Arthur no WhatsApp</a>
      </div>
    </div>

    <div style="text-align:center;margin-top:16px;">
      <div style="font-size:11px;color:#8B7E70;line-height:1.5;">Os números vêm da sua simulação e usam uma estimativa de rendimento, não uma promessa. O resultado real depende de onde você investe e do cenário.</div>
    </div>

    <div style="text-align:center;margin-top:20px;">
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#F5EFE6;margin-bottom:4px;">Arthur Notaroberto · Rakan | Vida Única</div>
      <div style="font-size:11px;color:#8B7E70;">Viva bem hoje sem comprometer o amanhã.</div>
    </div>
  </div>
</body></html>`;
}

// ===== E-mail para o ARTHUR (notificação de novo lead do simulador) =====
function buildSimuladorArthurHtml({ nome, email, whatsapp, simulador, dados, resultado, objetivoTipo }) {
  const label = SIM_LABELS[simulador] || simulador;
  const { headline, resumo } = simuladorConteudo(simulador, dados, resultado, objetivoTipo);
  const linhas = (resumo || []).map(([k, v]) => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;color:#2A2520;">${esc(k)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;font-weight:700;color:#2A2520;">${esc(v)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="pt-br"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:20px;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#2A2520;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;">
    <h2 style="font-family:Georgia,serif;color:#A0522D;margin:0 0 16px;">Novo lead (simulador)</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr><td style="padding:6px 0;font-size:14px;"><strong>Nome:</strong></td><td style="padding:6px 0;font-size:14px;">${esc(nome)}</td></tr>
      <tr><td style="padding:6px 0;font-size:14px;"><strong>E-mail:</strong></td><td style="padding:6px 0;font-size:14px;"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
      <tr><td style="padding:6px 0;font-size:14px;"><strong>WhatsApp:</strong></td><td style="padding:6px 0;font-size:14px;">${esc(whatsapp) || '—'}</td></tr>
      <tr><td style="padding:6px 0;font-size:14px;"><strong>Simulador:</strong></td><td style="padding:6px 0;font-size:14px;"><strong>${esc(label)}</strong></td></tr>
      ${objetivoTipo ? `<tr><td style="padding:6px 0;font-size:14px;"><strong>Objetivo:</strong></td><td style="padding:6px 0;font-size:14px;">${esc(objetivoTipo)}</td></tr>` : ''}
    </table>
    <p style="font-size:13px;color:#5A5249;line-height:1.5;margin:0 0 16px;">${esc(headline)}</p>
    <h3 style="font-size:14px;color:#5A5249;margin:0 0 8px;">Números da simulação</h3>
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

  // Origem do lead: "simulador" ou "checklist" (default, mantém compatibilidade).
  const source = body.source === 'simulador' ? 'simulador' : 'checklist';

  const from = `"Arthur Notaroberto" <${SMTP_USER}>`;

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // 465 = SSL; 587 = STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

    if (source === 'simulador') {
      // ===== Fluxo do SIMULADOR: mini plano de ação personalizado =====
      const SIMS = ['objetivo', 'independencia', 'aposentadoria', 'reserva', 'juros'];
      const simulador = SIMS.includes(body.simulador) ? body.simulador : 'objetivo';
      const dados = (body.dados && typeof body.dados === 'object') ? body.dados : {};
      const resultado = (body.resultado && typeof body.resultado === 'object') ? body.resultado : {};
      const objetivoTipo = (body.objetivoTipo || '').toString().trim().slice(0, 80);
      const label = SIM_LABELS[simulador] || 'Simulador';

      // 1) E-mail para o LEAD (mini plano)
      await transporter.sendMail({
        from,
        to: email,
        replyTo: ARTHUR_EMAIL,
        subject: `Seu plano no simulador: ${label}`,
        html: buildSimuladorLeadHtml({ nome, simulador, dados, resultado, objetivoTipo })
      });

      // 2) E-mail para o ARTHUR (notificação)
      await transporter.sendMail({
        from,
        to: ARTHUR_EMAIL,
        replyTo: email,
        subject: `Novo lead (simulador): ${nome} (${label})`,
        html: buildSimuladorArthurHtml({ nome, email, whatsapp, simulador, dados, resultado, objetivoTipo })
      });

      // Encaminha ao Funil do app (opcional; nunca quebra o fluxo do e-mail)
      await forwardToApp({ nome, email, whatsapp, source: 'simulador', simulador, objetivoTipo, dados, resultado });

    } else {
      // ===== Fluxo do CHECKLIST (raio-x) — comportamento original =====
      const respostas = Array.isArray(body.respostas) ? body.respostas : [];
      const ondeAgir = Array.isArray(body.ondeAgir) ? body.ondeAgir : [];
      const jaFunciona = Array.isArray(body.jaFunciona) ? body.jaFunciona : [];
      const etapa = (body.etapa || '').toString();

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
      await forwardToApp({ nome, email, whatsapp, etapa, respostas, source: 'checklist' });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Falha no envio de e-mail:', err && err.message ? err.message : err);
    res.status(502).json({ ok: false, error: 'Não consegui enviar agora. Tente de novo em instantes.' });
  }
};
