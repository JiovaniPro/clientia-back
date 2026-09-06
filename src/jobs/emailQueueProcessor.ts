import cron from "node-cron";
import { prisma } from "../db/prisma.js";
import { getScopedClient } from "../db/scopedClient.js";
import { renderTemplate } from "../lib/emailTemplating.js";
import { sendMail } from "../lib/mailer.js";
import { buildTemplateVariables } from "../modules/emails/service.js";

const DEDUPE_WINDOW_HOURS = 24;
const ACTIVE_APPOINTMENT_STATUSES = new Set(["EN_ATTENTE_DE_CONFIRMATION", "CONFIRME"]);
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Traite les lignes QUEUED de la file d'e-mails. Contrairement au produit d'origine
 * (file jamais consommée malgré son schéma complet), ce job la rend réellement
 * effective — voir décision #2 et §5 du plan d'architecture.
 *
 * Itère sur toutes les organisations (via le client de base non scopé, légitime ici
 * au même titre que le module `platform`) mais écrit toujours via un client scopé à
 * l'organisation de la ligne traitée — jamais de mutation via le client brut.
 *
 * Règles anti-spam appliquées avant tout envoi (interprétation faite pour cette V1,
 * pas de spec source détaillée disponible pour ce job) :
 * 1. Le client doit avoir une adresse e-mail — sinon SKIPPED.
 * 2. Si l'e-mail est lié à un rendez-vous, celui-ci doit encore être actif
 *    (EN_ATTENTE_DE_CONFIRMATION ou CONFIRME) — sinon CANCELLED.
 * 3. Pas de doublon : si un e-mail avec le même modèle a déjà été envoyé avec succès
 *    à ce client dans les dernières 24h, la ligne est SKIPPED plutôt que renvoyée.
 *
 * Sous-lot C3 : une ligne peut désormais viser un `recipientUserId` (rappel
 * d'événement, destinataire interne) au lieu d'un `clientId` — voir la branche
 * dédiée en tête de boucle. Ce chemin n'écrit jamais dans `EmailHistory` (table
 * pensée pour la communication client/agent, pas pour un rappel système interne) ;
 * son audit est le statut de la ligne `EmailQueue` elle-même, déjà visible.
 */
export async function processEmailQueue() {
  const now = new Date();
  const dueRows = await prisma.emailQueue.findMany({
    where: { status: "QUEUED", scheduledAt: { lte: now } },
    include: { client: true, emailTemplate: true, appointmentEvent: true, recipientUser: true },
    take: 100,
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of dueRows) {
    const db = getScopedClient(row.organizationId);
    await db.emailQueue.update({ where: { id: row.id }, data: { status: "PROCESSING" } });

    if (row.recipientUserId) {
      if (!row.recipientUser || !EMAIL_FORMAT.test(row.recipientUser.email)) {
        await db.emailQueue.update({
          where: { id: row.id },
          data: { status: "FAILED", processedAt: now, errorMessage: "Destinataire interne introuvable ou adresse invalide" },
        });
        failed++;
        continue;
      }

      const result = await sendMail({
        to: row.recipientUser.email,
        subject: row.directSubject ?? "",
        html: row.directBody ?? "",
      });

      if (result.sent) {
        await db.emailQueue.update({ where: { id: row.id }, data: { status: "SENT", processedAt: now } });
        sent++;
      } else {
        const retryCount = row.retryCount + 1;
        const exhausted = retryCount >= row.maxRetries;
        await db.emailQueue.update({
          where: { id: row.id },
          data: {
            status: exhausted ? "FAILED" : "QUEUED",
            retryCount,
            errorMessage: result.error ?? null,
            processedAt: exhausted ? now : null,
          },
        });
        failed++;
      }
      continue;
    }

    if (!row.client || !row.emailTemplate) {
      await db.emailQueue.update({
        where: { id: row.id },
        data: { status: "FAILED", processedAt: now, errorMessage: "Ligne de file invalide : ni destinataire interne ni client" },
      });
      failed++;
      continue;
    }

    if (!row.client.email) {
      await db.emailQueue.update({
        where: { id: row.id },
        data: { status: "SKIPPED", processedAt: now, errorMessage: "Client sans adresse e-mail" },
      });
      skipped++;
      continue;
    }

    if (row.appointmentEvent?.status && !ACTIVE_APPOINTMENT_STATUSES.has(row.appointmentEvent.status)) {
      await db.emailQueue.update({
        where: { id: row.id },
        data: { status: "CANCELLED", processedAt: now, errorMessage: "Rendez-vous non actif" },
      });
      skipped++;
      continue;
    }

    const dedupeSince = new Date(now.getTime() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000);
    const recentDuplicate = await db.emailHistory.findFirst({
      where: {
        clientId: row.client.id,
        templateKeySnapshot: row.emailTemplate.key,
        createdAt: { gte: dedupeSince },
        status: "SENT",
      },
    });
    if (recentDuplicate) {
      await db.emailQueue.update({
        where: { id: row.id },
        data: { status: "SKIPPED", processedAt: now, errorMessage: "Doublon récent" },
      });
      skipped++;
      continue;
    }

    const organization = await db.organization.findUnique({ where: { id: row.organizationId } });
    if (!organization) {
      await db.emailQueue.update({
        where: { id: row.id },
        data: { status: "FAILED", processedAt: now, errorMessage: "Organisation introuvable" },
      });
      failed++;
      continue;
    }

    const variables = buildTemplateVariables({
      client: row.client,
      organization,
      event: row.appointmentEvent ? { startAt: row.appointmentEvent.startAt, endAt: row.appointmentEvent.endAt } : null,
    });
    const subject = renderTemplate(row.emailTemplate.subject, variables);
    const body = renderTemplate(row.emailTemplate.body, variables);

    const result = await sendMail({ to: row.client.email, subject, html: body });

    await db.emailHistory.create({
      data: {
        organizationId: row.organizationId,
        clientId: row.client.id,
        appointmentEventId: row.appointmentEventId ?? null,
        emailTemplateId: row.emailTemplate.id,
        templateKeySnapshot: row.emailTemplate.key,
        subject,
        body,
        recipientEmail: row.client.email,
        sentAt: result.sent ? now : null,
        agentCallisteId: row.createdById ?? row.client.agentId,
        status: result.sent ? "SENT" : "FAILED",
        errorMessage: result.error ?? null,
        isAutomated: true,
      },
    });

    if (result.sent) {
      await db.emailQueue.update({ where: { id: row.id }, data: { status: "SENT", processedAt: now } });
      sent++;
    } else {
      const retryCount = row.retryCount + 1;
      const exhausted = retryCount >= row.maxRetries;
      await db.emailQueue.update({
        where: { id: row.id },
        data: {
          status: exhausted ? "FAILED" : "QUEUED",
          retryCount,
          errorMessage: result.error ?? null,
          processedAt: exhausted ? now : null,
        },
      });
      failed++;
    }
  }

  return { processed: dueRows.length, sent, failed, skipped };
}

/** Toutes les 5 minutes. */
export function scheduleEmailQueueProcessor() {
  cron.schedule("*/5 * * * *", () => {
    processEmailQueue().catch((error) => console.error("[emailQueueProcessor]", error));
  });
}
