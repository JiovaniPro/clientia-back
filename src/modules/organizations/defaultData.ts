import { Prisma } from "../../generated/prisma/client.js";
import { DEFAULT_ROLES } from "../../lib/defaultRoles.js";

/**
 * Valeurs par défaut des listes configurables, provisionnées à la création d'une
 * organisation. `metadata` porte les drapeaux comportementaux lus par ConfigService
 * (§4 du plan d'architecture) — c'est ce qui remplace les tests d'enum en dur du
 * produit d'origine (ex: `status === 'RAPPEL'` devient `metadata.requiresRecallDate`).
 */
interface DefaultListItem {
  key: string;
  label: string;
  color?: string;
  order: number;
  isDefault?: boolean;
  metadata?: Record<string, boolean>;
}

const CALL_STATUS: DefaultListItem[] = [
  { key: "A_CONTACTER", label: "À contacter", color: "#6B7280", order: 0, isDefault: true },
  { key: "NE_REPOND_PAS", label: "Ne répond pas", color: "#D97706", order: 1, metadata: { requiresRecallDate: true } },
  { key: "OCCUPE", label: "Occupé", color: "#D97706", order: 2, metadata: { requiresRecallDate: true } },
  { key: "REPONDEUR", label: "Répondeur", color: "#D97706", order: 3, metadata: { requiresRecallDate: true } },
  { key: "RAPPEL", label: "À rappeler", color: "#D97706", order: 4, metadata: { requiresRecallDate: true } },
  { key: "PAS_INTERESSE", label: "Pas intéressé", color: "#DC2626", order: 5 },
  { key: "NUMERO_INVALIDE", label: "Numéro invalide", color: "#DC2626", order: 6 },
  { key: "DEJA_CLIENT", label: "Déjà client", color: "#DC2626", order: 7 },
  { key: "NE_PAS_RAPPELER", label: "Ne pas rappeler", color: "#DC2626", order: 8 },
  { key: "RDV_PRIS", label: "RDV pris", color: "#16A34A", order: 9, metadata: { triggersClientDossierCreation: true } },
  { key: "AUTRE", label: "Autre", color: "#6B7280", order: 10 },
];

const CLIENT_DOSSIER_STATUS: DefaultListItem[] = [
  { key: "NOUVEAU", label: "Nouveau", color: "#6B7280", order: 0, isDefault: true },
  { key: "EN_COURS", label: "En cours", color: "#D97706", order: 1 },
  { key: "COMPLET", label: "Complet", color: "#16A34A", order: 2 },
  { key: "CLOTURE", label: "Clôturé", color: "#6B7280", order: 3 },
];

const CLIENT_FINAL_STATUS: DefaultListItem[] = [
  { key: "EN_COURS", label: "En cours", color: "#D97706", order: 0, isDefault: true },
  { key: "DOSSIER_VALIDE", label: "Dossier validé", color: "#16A34A", order: 1 },
  { key: "EN_ATTENTE_PIECES", label: "En attente de pièces", color: "#D97706", order: 2 },
  { key: "DOSSIER_REFUSE", label: "Dossier refusé", color: "#DC2626", order: 3 },
  { key: "ANNULE", label: "Annulé", color: "#DC2626", order: 4 },
  { key: "SANS_SUITE", label: "Sans suite", color: "#6B7280", order: 5 },
];

const CLIENT_COUNTRY: DefaultListItem[] = [
  { key: "FRANCE", label: "France", order: 0, isDefault: true },
  { key: "SUISSE", label: "Suisse", order: 1 },
  { key: "BELGIQUE", label: "Belgique", order: 2 },
  { key: "LUXEMBOURG", label: "Luxembourg", order: 3 },
  { key: "AUTRE", label: "Autre", order: 4 },
];

const CLIENT_CIVILITE: DefaultListItem[] = [
  { key: "MONSIEUR", label: "Monsieur", order: 0, isDefault: true },
  { key: "MADAME", label: "Madame", order: 1 },
];

const CLIENT_MARITAL_STATUS: DefaultListItem[] = [
  { key: "CELIBATAIRE", label: "Célibataire", order: 0, isDefault: true },
  { key: "MARIE", label: "Marié(e)", order: 1 },
  { key: "PACSE", label: "Pacsé(e)", order: 2 },
  { key: "DIVORCE", label: "Divorcé(e)", order: 3 },
  { key: "VEUF", label: "Veuf / Veuve", order: 4 },
];

const CLIENT_CHILDREN: DefaultListItem[] = [
  { key: "AUCUN", label: "Aucun", order: 0, isDefault: true },
  { key: "UN", label: "1", order: 1 },
  { key: "DEUX", label: "2", order: 2 },
  { key: "TROIS", label: "3", order: 3 },
  { key: "QUATRE_PLUS", label: "4 et plus", order: 4 },
];

const CLIENT_TYPE_RDV: DefaultListItem[] = [
  { key: "RDV_DOMICILE", label: "RDV à domicile", order: 0, isDefault: true, metadata: { requiresAddress: true } },
  { key: "RDV_TELEPHONIQUE", label: "RDV téléphonique", order: 1 },
  { key: "RDV_VISIO", label: "RDV visio", order: 2 },
  { key: "RDV_AGENCE", label: "RDV en agence", order: 3 },
];

export const DEFAULT_CONFIGURABLE_LISTS: Record<string, DefaultListItem[]> = {
  CALL_STATUS,
  CLIENT_DOSSIER_STATUS,
  CLIENT_FINAL_STATUS,
  CLIENT_COUNTRY,
  CLIENT_CIVILITE,
  CLIENT_MARITAL_STATUS,
  CLIENT_CHILDREN,
  CLIENT_TYPE_RDV,
};

interface DefaultEmailTemplate {
  key: string;
  label: string;
  subject: string;
  body: string;
}

/**
 * 7 modèles par défaut (P1.4) — chaque organisation part de ceux-ci, marqués
 * `isSystem: true` (reste éditable, juste non supprimable). Placeholders au format
 * {{variable}}, résolus par le module `emails` au moment de l'envoi/de l'enqueue.
 */
export const DEFAULT_EMAIL_TEMPLATES: DefaultEmailTemplate[] = [
  {
    key: "confirmation_rdv",
    label: "Confirmation de rendez-vous",
    subject: "Confirmation de votre rendez-vous du {{date_rdv}}",
    body: "Bonjour {{prenom_client}},\n\nNous vous confirmons votre rendez-vous le {{date_rdv}} à {{heure_rdv}} avec {{nom_agent}}.\n\nCordialement,\n{{nom_organisation}}",
  },
  {
    key: "rappel_veille",
    label: "Rappel la veille du rendez-vous",
    subject: "Rappel : rendez-vous demain à {{heure_rdv}}",
    body: "Bonjour {{prenom_client}},\n\nPetit rappel : vous avez rendez-vous demain à {{heure_rdv}} avec {{nom_agent}}.\n\nCordialement,\n{{nom_organisation}}",
  },
  {
    key: "confirmation_domicile",
    label: "Confirmation de rendez-vous à domicile",
    subject: "Confirmation de votre rendez-vous à domicile du {{date_rdv}}",
    body: "Bonjour {{prenom_client}},\n\n{{nom_agent}} se rendra à votre domicile ({{adresse_client}}) le {{date_rdv}} à {{heure_rdv}}.\n\nCordialement,\n{{nom_organisation}}",
  },
  {
    key: "annulation_rdv",
    label: "Annulation de rendez-vous",
    subject: "Annulation de votre rendez-vous du {{date_rdv}}",
    body: "Bonjour {{prenom_client}},\n\nVotre rendez-vous du {{date_rdv}} à {{heure_rdv}} a été annulé. N'hésitez pas à nous recontacter pour en reprogrammer un.\n\nCordialement,\n{{nom_organisation}}",
  },
  {
    key: "bienvenue_dossier",
    label: "Bienvenue - dossier créé",
    subject: "Votre dossier a bien été créé",
    body: "Bonjour {{prenom_client}},\n\nVotre dossier a bien été créé par notre équipe. Nous revenons vers vous prochainement.\n\nCordialement,\n{{nom_organisation}}",
  },
  {
    key: "relance_sans_reponse",
    label: "Relance sans réponse",
    subject: "Nous n'avons pas réussi à vous joindre",
    body: "Bonjour {{prenom_client}},\n\nNous avons essayé de vous joindre sans succès. Merci de nous rappeler au {{telephone_organisation}} à votre convenance.\n\nCordialement,\n{{nom_organisation}}",
  },
  {
    key: "document_a_fournir",
    label: "Documents à fournir",
    subject: "Documents nécessaires à votre dossier",
    body: "Bonjour {{prenom_client}},\n\nPour finaliser votre dossier, merci de nous transmettre les documents suivants : {{liste_documents}}.\n\nCordialement,\n{{nom_organisation}}",
  },
];

/**
 * Provisionne les 3 rôles système, les listes configurables par défaut et les 7
 * modèles d'e-mail par défaut pour une organisation nouvellement créée.
 * Le catalogue global `Permission` n'est PAS créé ici — il est seedé une seule fois,
 * globalement, par prisma/seed.ts (voir seedPermissionsCatalog).
 *
 * `tx` doit être un client Prisma déjà dans une transaction (ou le client de base
 * pour le seed initial) — jamais le client scopé (l'organisation n'existe pas encore
 * au moment du premier appel depuis le module `organizations`).
 */
export async function provisionDefaultOrganizationData(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<void> {
  const allPermissions = await tx.permission.findMany({ select: { id: true, key: true } });
  const permissionIdByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

  for (const roleDef of DEFAULT_ROLES) {
    const role = await tx.role.create({
      data: {
        organizationId,
        name: roleDef.name,
        description: roleDef.description,
        color: roleDef.color,
        isSystem: true,
      },
    });

    const rolePermissionsData = roleDef.permissionKeys
      .map((key) => permissionIdByKey.get(key))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ roleId: role.id, permissionId }));

    if (rolePermissionsData.length > 0) {
      await tx.rolePermission.createMany({ data: rolePermissionsData });
    }
  }

  for (const [listKey, items] of Object.entries(DEFAULT_CONFIGURABLE_LISTS)) {
    await tx.configurableListItem.createMany({
      data: items.map((item) => ({
        organizationId,
        listKey,
        key: item.key,
        label: item.label,
        color: item.color ?? null,
        order: item.order,
        isDefault: item.isDefault ?? false,
        metadata: item.metadata ?? Prisma.JsonNull,
      })),
    });
  }

  await tx.emailTemplate.createMany({
    data: DEFAULT_EMAIL_TEMPLATES.map((template) => ({
      organizationId,
      key: template.key,
      label: template.label,
      subject: template.subject,
      body: template.body,
      isSystem: true,
    })),
  });
}
