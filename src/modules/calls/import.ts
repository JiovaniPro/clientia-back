import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { BadRequest } from "../../lib/httpError.js";

export interface ImportRow {
  firstName?: string;
  lastName?: string;
  phoneNumber: string;
  email?: string;
}

const COLUMN_ALIASES: Record<string, keyof ImportRow> = {
  prenom: "firstName",
  "prénom": "firstName",
  firstname: "firstName",
  nom: "lastName",
  lastname: "lastName",
  telephone: "phoneNumber",
  "téléphone": "phoneNumber",
  phone: "phoneNumber",
  phonenumber: "phoneNumber",
  numero: "phoneNumber",
  "numéro": "phoneNumber",
  email: "email",
  "e-mail": "email",
  mail: "email",
};

function normalizeHeader(header: string): keyof ImportRow | null {
  return COLUMN_ALIASES[header.trim().toLowerCase()] ?? null;
}

function rowsFromRecords(records: Record<string, unknown>[]): ImportRow[] {
  return records
    .map((record) => {
      const row: Partial<ImportRow> = {};
      for (const [header, value] of Object.entries(record)) {
        const field = normalizeHeader(header);
        if (field && value !== undefined && value !== null && String(value).trim() !== "") {
          row[field] = String(value).trim();
        }
      }
      return row;
    })
    .filter((row): row is ImportRow => Boolean(row.phoneNumber));
}

/** Accepte .csv et .xlsx/.xls — colonnes reconnues par alias (prénom/nom/téléphone/email, FR/EN). */
export function parseImportFile(buffer: Buffer, originalName: string): ImportRow[] {
  const isCsv = originalName.toLowerCase().endsWith(".csv");

  if (isCsv) {
    const records = parse(buffer, { columns: true, skip_empty_lines: true, trim: true }) as Record<
      string,
      unknown
    >[];
    return rowsFromRecords(records);
  }

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw BadRequest("Fichier vide");
  }
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    throw BadRequest("Fichier vide");
  }
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return rowsFromRecords(records);
}
