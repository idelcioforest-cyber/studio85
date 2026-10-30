/**
 * Modelos de e-mail do Studio 85. HTML em tabelas com estilos inline (Gmail, Outlook, Apple Mail),
 * sempre com versão em texto puro. O logo e as fotos vão como anexos inline (cid:), então aparecem
 * mesmo quando o leitor de e-mail bloqueia imagens externas.
 */

export const LOGO_CID = 'logo@studio85';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface ShopInfo {
  company: string;
  address: string;
  mapsUrl: string;
  whatsappUrl: string;
  whatsappDisplay: string;
  appUrl: string;
}

export interface AppointmentEmailData {
  firstName: string;
  vehicle: string;
  plate: string;
  services: string;
  date: string;
  time: string;
  total: string;
  code: string;
  /** cids das fotos de depois já anexadas */
  photoCids?: string[];
}

const COLORS = {
  page: '#f4f4f5',
  card: '#ffffff',
  header: '#09090b',
  accent: '#f5b800',
  ink: '#18181b',
  muted: '#52525b',
  line: '#e4e4e7',
  subtle: '#fafafa',
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function button(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">
  <tr><td align="center" bgcolor="${COLORS.accent}" style="border-radius:10px">
    <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:700;color:${COLORS.header};text-decoration:none;border-radius:10px">${escapeHtml(label)}</a>
  </td></tr>
</table>`;
}

function details(rows: [string, string][]): string {
  const body = rows
    .map(
      ([label, value], i) => `<tr>
    <td style="padding:12px 16px;font-family:${FONT};font-size:14px;color:${COLORS.muted};${i ? `border-top:1px solid ${COLORS.line};` : ''}">${escapeHtml(label)}</td>
    <td align="right" style="padding:12px 16px;font-family:${FONT};font-size:14px;font-weight:600;color:${COLORS.ink};${i ? `border-top:1px solid ${COLORS.line};` : ''}">${escapeHtml(value)}</td>
  </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${COLORS.line};border-radius:12px;border-collapse:separate;background:${COLORS.subtle}">${body}</table>`;
}

function photos(cids: string[]): string {
  if (!cids.length) return '';
  const cells = cids.map(
    (cid) =>
      `<td width="50%" style="padding:4px"><img src="cid:${cid}" alt="Foto do carro depois do serviço" width="248" style="display:block;width:100%;max-width:248px;height:auto;border-radius:10px;border:0"></td>`,
  );
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(`<tr>${cells[i]}${cells[i + 1] ?? '<td width="50%"></td>'}</tr>`);
  return `<p style="margin:28px 0 8px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${COLORS.muted}">Como ficou</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -4px">${rows.join('')}</table>`;
}

function layout(shop: ShopInfo, opts: { preheader: string; title: string; content: string; reason: string }): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page}">
<tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${COLORS.card};border-radius:16px;overflow:hidden">
    <tr><td align="center" bgcolor="${COLORS.header}" style="background:${COLORS.header};padding:28px 24px 24px">
      <img src="cid:${LOGO_CID}" alt="${escapeHtml(shop.company)}" width="120" style="display:block;width:120px;height:auto;border:0">
    </td></tr>
    <tr><td style="height:4px;line-height:4px;font-size:0;background:${COLORS.accent}">&nbsp;</td></tr>
    <tr><td style="padding:32px 28px 8px;font-family:${FONT}">
      <h1 style="margin:0 0 12px;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:800;color:${COLORS.ink}">${escapeHtml(opts.title)}</h1>
      ${opts.content}
    </td></tr>
    <tr><td style="padding:24px 28px 28px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${COLORS.line}">
        <tr><td style="padding-top:20px;font-family:${FONT};font-size:13px;line-height:1.6;color:${COLORS.muted}">
          <strong style="color:${COLORS.ink}">${escapeHtml(shop.company)}</strong> · Estética automotiva<br>
          <a href="${escapeHtml(shop.mapsUrl)}" target="_blank" style="color:${COLORS.muted};text-decoration:underline">${escapeHtml(shop.address)}</a><br>
          WhatsApp: <a href="${escapeHtml(shop.whatsappUrl)}" target="_blank" style="color:${COLORS.muted};text-decoration:underline">${escapeHtml(shop.whatsappDisplay)}</a>
        </td></tr>
        <tr><td style="padding-top:12px;font-family:${FONT};font-size:12px;line-height:1.5;color:#71717a">${escapeHtml(opts.reason)}</td></tr>
      </table>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:${COLORS.ink}">${html}</p>`;
}

function note(html: string): string {
  return `<p style="margin:16px 0 0;font-family:${FONT};font-size:14px;line-height:1.6;color:${COLORS.muted}">${html}</p>`;
}

function footerText(shop: ShopInfo): string {
  return [`${shop.company} · Estética automotiva`, shop.address, `WhatsApp: ${shop.whatsappDisplay}`].join('\n');
}

export function codeEmail(
  shop: ShopInfo,
  kind: 'verify' | 'reset',
  firstName: string,
  code: string,
): EmailContent {
  const isReset = kind === 'reset';
  const title = isReset ? 'Crie uma nova senha' : 'Confirme seu e-mail';
  const intro = isReset
    ? 'Recebemos um pedido para trocar a senha da sua conta. Use o código abaixo no app:'
    : 'Falta pouco para ativar sua conta. Use o código abaixo no app:';
  const ignore = isReset
    ? 'Se você não pediu para trocar a senha, ignore este e-mail: sua senha atual continua valendo.'
    : 'Se você não criou uma conta no Studio 85, ignore este e-mail.';

  const content = [
    paragraph(`Olá, ${escapeHtml(firstName)}!`),
    paragraph(intro),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:8px 0 4px">
      <div style="display:inline-block;padding:16px 28px;border:1px solid ${COLORS.line};border-radius:12px;background:${COLORS.subtle};font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:${COLORS.ink}">${escapeHtml(code)}</div>
    </td></tr></table>`,
    note(`O código vale por 15 minutos. ${escapeHtml(ignore)}`),
  ].join('\n');

  return {
    subject: `${code} é o seu código ${isReset ? 'para criar uma nova senha' : 'de verificação'} — ${shop.company}`,
    html: layout(shop, {
      preheader: `Seu código: ${code}. Vale por 15 minutos.`,
      title,
      content,
      reason: 'Você recebeu este e-mail porque este endereço foi usado no app do Studio 85.',
    }),
    text: [
      `Olá, ${firstName}!`,
      '',
      intro,
      '',
      code,
      '',
      `O código vale por 15 minutos. ${ignore}`,
      '',
      footerText(shop),
    ].join('\n'),
  };
}

export function appointmentEmail(
  shop: ShopInfo,
  kind: 'APPOINTMENT_CONFIRMED' | 'CAR_READY',
  data: AppointmentEmailData,
): EmailContent {
  const ready = kind === 'CAR_READY';
  const myAppointmentsUrl = `${shop.appUrl.replace(/\/$/, '')}/meus-agendamentos`;

  const title = ready ? 'Seu carro está pronto' : 'Agendamento confirmado';
  const intro = ready
    ? `O <strong>${escapeHtml(data.vehicle)}</strong> (${escapeHtml(data.plate)}) já está pronto e pode ser retirado.`
    : `Seu horário está reservado. Confira os detalhes:`;
  const rows: [string, string][] = ready
    ? [
        ['Serviços', data.services],
        ['Total', data.total],
        ['Código', data.code],
      ]
    : [
        ['Data', data.date],
        ['Horário', data.time],
        ['Veículo', `${data.vehicle} · ${data.plate}`],
        ['Serviços', data.services],
        ['Total', data.total],
        ['Código', data.code],
      ];

  const content = [
    paragraph(`Olá, ${escapeHtml(data.firstName)}!`),
    paragraph(intro),
    details(rows),
    ready ? photos(data.photoCids ?? []) : '',
    `<div style="height:28px;line-height:28px;font-size:0">&nbsp;</div>`,
    button(ready ? 'Como chegar' : 'Ver meu agendamento', ready ? shop.mapsUrl : myAppointmentsUrl),
    `<p style="margin:16px 0 0;text-align:center;font-family:${FONT};font-size:14px">
      <a href="${escapeHtml(ready ? myAppointmentsUrl : shop.mapsUrl)}" target="_blank" style="color:${COLORS.ink};font-weight:600;text-decoration:underline">${ready ? 'Ver no app' : 'Como chegar'}</a>
    </p>`,
    note(
      ready
        ? 'O pagamento é feito na retirada, por Pix, cartão ou dinheiro.'
        : 'Precisa remarcar ou cancelar? Faça pelo app ou fale com a gente pelo WhatsApp.',
    ),
  ].join('\n');

  const textRows = rows.map(([label, value]) => `${label}: ${value}`);
  return {
    subject: ready ? `Seu ${data.vehicle} está pronto — ${shop.company}` : `Agendamento confirmado: ${data.date}, ${data.time} — ${shop.company}`,
    html: layout(shop, {
      preheader: ready ? `O ${data.vehicle} já pode ser retirado.` : `${data.date} às ${data.time} · ${data.services}`,
      title,
      content,
      reason: 'Você recebeu este e-mail porque tem um agendamento no Studio 85.',
    }),
    text: [
      `Olá, ${data.firstName}!`,
      '',
      ready ? `O ${data.vehicle} (${data.plate}) já está pronto e pode ser retirado.` : 'Seu horário está reservado.',
      '',
      ...textRows,
      '',
      ready ? `Como chegar: ${shop.mapsUrl}` : `Ver meu agendamento: ${myAppointmentsUrl}`,
      ready ? 'O pagamento é feito na retirada, por Pix, cartão ou dinheiro.' : 'Precisa remarcar ou cancelar? Faça pelo app ou fale com a gente pelo WhatsApp.',
      '',
      footerText(shop),
    ].join('\n'),
  };
}
