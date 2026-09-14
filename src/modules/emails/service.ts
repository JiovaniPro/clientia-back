import type { ScopedPrismaClient } from "../../db/scopedClient.js";
import { AuditAction } from "../../generated/prisma/enums.js";
import { recordAuditLog } from "../../lib/auditLog.js";
import { renderTemplate } from "../../lib/emailTemplating.js";
import { BadRequest, Conflict, NotFound } from "../../lib/httpError.js";
import { sendMail } from "../../lib/mailer.js";
import type { AuthenticatedUser } from "../../types/express.js";
import type { CreateEmailTemplateInput, SendEmailInput, UpdateEmailTemplateInput } from "./schema.js";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });
const timeFormatter = new Intl.DateTimeFormat("fr-FR", { timeStyle: "short" });

/** Fonction pure — réutilisée à la fois par l'envoi manuel et par jobs/emailQueueProcessor.ts. */
export function buildTemplateVariables(params: {
  client: { firstName: string | null; lastName: string | null; adresse: string | null; phoneNumber: string };
  organization: { name: string };
  event?: { startAt: Date; endAt: Date } | null;
  extra?: Record<string, string>;
}): Record<string, string> {
  return {
    prenom_client: params.client.firstName ?? "",
    nom_client: params.client.lastName ?? "",
    adresse_client: params.client.adresse ?? "",
    telephone_client: params.client.phoneNumber,
    nom_organisation: params.organization.name,
    date_rdv: params.event ? dateFormatter.format(params.event.startAt) : "",
    heure_rdv: params.event ? timeFormatter.format(params.event.startAt) : "",
    ...params.extra,
  };
}

// =========================================================================
// Modèles
// =========================================================================

export async function listTemplates(db: ScopedPrismaClient) {
  return db.emailTemplate.findMany({ orderBy: { label: "asc" } });
}

export async function createTemplate(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  input: CreateEmailTemplateInput,
) {
  const existing = await db.emailTemplate.findFirst({ where: { key: input.key } });
  if (existing) throw Conflict("Un modèle porte déjà cette clé");

  const template = await db.emailTemplate.create({
    data: {
      organizationId: user.organizationId,
      key: input.key,
      label: input.label,
      subject: input.subject,
      body: input.body,
      defaultAttachmentPath: input.defaultAttachmentPath ?? null,
    },
  });

  await recordAuditLog(db, {
    userId: user.id,
    action: AuditAction.EMAIL_TEMPLATE_CREATED,
    entity: "EmailTemplate",
    entityId: template.id,
  });
  return template;
}

export async function updateTemplate(
  db: ScopedPrismaClient,
  user: AuthenticatedUser,
  id: string,
  input: UpdateEmailTemplateInput,
) {
  const existing = await db.emailTemplate.findUnique({ where: { id } });
  if (!existing) throw NotFound("Modèle introuvable");

  const template = await db.emailTemplate.update({
    where: { id },
    data: {
      label: input.label ?? existing.label,
      subject: input.subject ?? existing.subject,
      body: input.body ?? existing.body,
      defaultAttachmentPath: input.defaultAttachmentPath ?? existing.defaultAttachmentPath,
      isActive: input.isActive ?? existing.isActive,
    },
  });

  await recordAuditLog(db, {
    userId: user.id,
    action: AuditAction.EMAIL_TEMPLATE_UPDATED,
    entity: "EmailTemplate",
    entityId: id,
  });
  return template;
}

// =========================================================================
// Envoi manuel — écrit directement dans EmailHistory, en dehors de la file (§5 du plan).
// =========================================================================

export async function listHistory(db: ScopedPrismaClient, clientId?: string) {
  return db.emailHistory.findMany({
    where: clientId ? { clientId } : {},
    orderBy: { createdAt: "desc" },
  });
}

export async function sendManualEmail(db: ScopedPrismaClient, user: AuthenticatedUser, input: SendEmailInput) {
  const [client, template, organization] = await Promise.all([
    db.client.findUnique({ where: { id: input.clientId } }),
    db.emailTemplate.findFirst({ where: { key: input.templateKey, isActive: true } }),
    db.organization.findUnique({ where: { id: user.organizationId } }),
  ]);

  if (!client) throw NotFound("Dossier client introuvable");
  if (!template) throw NotFound("Modèle d'e-mail introuvable");
  if (!organization) throw NotFound("Organisation introuvable");
  if (!client.email) throw BadRequest("Ce client n'a pas d'adresse e-mail");

  const event = input.appointmentEventId
    ? await db.calendarEvent.findUnique({
        where: { id: input.appointmentEventId },
        select: { startAt: true, endAt: true },
      })
    : null;

  const variables = buildTemplateVariables({
    client,
    organization,
    event,
    ...(input.variables ? { extra: input.variables } : {}),
  });
  const subject = renderTemplate(template.subject, variables);
  const body = renderTemplate(template.body, variables);

  const result = await sendMail({ to: client.email, subject, html: body });

  const history = await db.emailHistory.create({
    data: {
      organizationId: user.organizationId,
      clientId: client.id,
      appointmentEventId: input.appointmentEventId ?? null,
      emailTemplateId: template.id,
      templateKeySnapshot: template.key,
      subject,
      body,
      recipientEmail: client.email,
      sentAt: result.sent ? new Date() : null,
      agentCallisteId: user.id,
      status: result.sent ? "SENT" : "FAILED",
      errorMessage: result.error ?? null,
      isAutomated: false,
    },
  });

  await recordAuditLog(db, {
    userId: user.id,
    action: AuditAction.EMAIL_SENT,
    entity: "EmailHistory",
    entityId: history.id,
    meta: { templateKey: template.key },
  });

  return history;
}

// =========================================================================
// File d'envoi automatique — consommée par jobs/emailQueueProcessor.ts.
// =========================================================================

export async function enqueueEmail(
  db: ScopedPrismaClient,
  organizationId: string,
  params: {
    clientId: string;
    templateKey: string;
    appointmentEventId?: string;
    scheduledAt: Date;
    createdById?: string;
  },
) {
  const template = await db.emailTemplate.findFirst({ where: { key: params.templateKey, isActive: true } });
  if (!template) return null; // organisation sans ce modèle activé — pas d'échec bruyant, juste pas d'enqueue

  return db.emailQueue.create({
    data: {
      organizationId,
      appointmentEventId: params.appointmentEventId ?? null,
      clientId: params.clientId,
      emailTemplateId: template.id,
      scheduledAt: params.scheduledAt,
      isAutomated: true,
      createdById: params.createdById ?? null,
    },
  });
}

/**
 * E-mail interne (destinataire = User, pas Client) — même file/mêmes retries que
 * `enqueueEmail` (décision actée au sous-lot C3 : pas d'envoi direct qui peut se
 * perdre sur un échec SMTP ponctuel), mais sans EmailTemplate organisation :
 * contenu fixe composé par l'appelant (`directSubject`/`directBody`), pas de
 * placeholders. Introduit pour les rappels d'événement (C3, méthode EMAIL),
 * réutilisé pour les liens de réinitialisation de mot de passe (sous-lot
 * Utilisateurs) — générique malgré le nom historique du fichier appelant.
 */
export async function enqueueInternalEmail(
  db: ScopedPrismaClient,
  organizationId: string,
  params: { recipientUserId: string; subject: string; body: string },
) {
  return db.emailQueue.create({
    data: {
      organizationId,
      recipientUserId: params.recipientUserId,
      directSubject: params.subject,
      directBody: params.body,
      scheduledAt: new Date(),
      isAutomated: true,
    },
  });
}
