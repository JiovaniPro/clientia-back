import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;
let transporterInitialized = false;

/** Sans SMTP_HOST configuré (dev), l'envoi est simulé (journalisé) plutôt que bloqué. */
function getTransporter(): nodemailer.Transporter | null {
  if (transporterInitialized) return transporter;
  transporterInitialized = true;

  if (!process.env.SMTP_HOST) return null;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  return transporter;
}

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; path: string }[];
}

export interface SendMailResult {
  sent: boolean;
  error?: string;
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const client = getTransporter();

  if (!client) {
    console.log(`[mailer] SMTP non configuré — e-mail simulé vers ${input.to} : "${input.subject}"`);
    return { sent: true };
  }

  try {
    await client.sendMail({
      from: process.env.SMTP_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      attachments: input.attachments,
    });
    return { sent: true };
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : String(error) };
  }
}
