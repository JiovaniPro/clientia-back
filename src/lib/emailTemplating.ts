/** Substitution de placeholders `{{variable}}` — voir les 7 modèles par défaut dans organizations/defaultData.ts. */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => variables[key] ?? "");
}
