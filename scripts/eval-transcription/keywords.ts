// Nøkkelord-uttrekk: finner kandidat-egennavn og tall i transkriptene og bygger en
// matrise over HVILKE providere som produserte hver variant. Poenget er å løfte fram
// uenighet — der providerne spriker på et navn ("Cuba" vs "Kuba", "Brave" vs "Braie")
// er nettopp der kvaliteten avgjøres. WER ser ikke dette; denne matrisa gjør.
// Ingen alignment nødvendig: cellene er ren medlemskapstest (har provider ordet?).

import type { ProviderReport } from "./types";
import { tokenize } from "./text";

// Vanlige ord som ofte står først i en setning (stor forbokstav) men ikke er egennavn.
const STOPLIST = new Set([
  "ja", "nei", "jo", "hei", "hallo", "skal", "det", "den", "de", "jeg", "du",
  "vi", "dere", "han", "hun", "så", "har", "er", "var", "men", "og", "eller",
  "kanskje", "herlig", "veldig", "mange", "stemmer", "kjenner", "ser", "tror",
  "ringer", "jobber", "hvilke", "hvilket", "hva", "hvordan", "når", "hvor",
  "ikke", "også", "bra", "takk", "ok", "okei", "greit", "fint", "her", "der",
  "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag",
  "januar", "februar", "mars", "april", "mai", "juni", "juli", "august",
  "september", "oktober", "november", "desember", "klokka", "klokken",
]);

type Token = { surface: string; key: string };

// Kandidat = tall, ELLER ord med stor forbokstav som ikke er setningsstart/stoppord.
function candidateTokens(text: string): Token[] {
  const out: Token[] = [];
  // Splitt på mellomrom, men hold på tegnsetting for å se setningsgrenser.
  const rawWords = text.split(/\s+/).filter(Boolean);
  let atSentenceStart = true;
  for (const raw of rawWords) {
    const word = raw.replace(/^[^0-9A-Za-zÆØÅæøå]+|[^0-9A-Za-zÆØÅæøå]+$/g, "");
    const endsSentence = /[.!?]$/.test(raw);
    if (word) {
      const isNumber = /^\d+$/.test(word);
      const isProper =
        /^[A-ZÆØÅ]/.test(word) &&
        word.length >= 2 &&
        !STOPLIST.has(word.toLowerCase());
      // Egennavn teller bare hvis det IKKE er setningsstart (stor forbokstav der er triviell).
      if (isNumber || (isProper && !atSentenceStart)) {
        out.push({ surface: word, key: word.toLowerCase() });
      }
    }
    atSentenceStart = endsSentence;
  }
  return out;
}

function transcriptFor(r: ProviderReport): string {
  if (r.batch && !r.batch.error && r.batch.transcript) return r.batch.transcript;
  if (r.streaming && !r.streaming.error && r.streaming.transcript) return r.streaming.transcript;
  return "";
}

export type KeywordRow = {
  surface: string;
  present: boolean[]; // per provider, samme rekkefølge som providerNames
  agreement: number; // antall providere som har ordet
  inFasit?: boolean; // står ordet i fasiten? (kun satt når fasit er oppgitt)
};

export type KeywordMatrix = {
  providerNames: string[];
  rows: KeywordRow[];
};

export function buildKeywordMatrix(
  reports: ProviderReport[],
  fasitText?: string
): KeywordMatrix {
  // Sett av riktige ord (lowercase + tallord→siffer) for å auto-fylle «Fasit?».
  const fasitKeys = fasitText ? new Set(tokenize(fasitText)) : null;
  const providerNames = reports.map((r) => r.name);
  // Per provider: sett av nøkkel (lowercase) + et representativt surface-form.
  const providerKeys: Set<string>[] = [];
  const surfaceByKey = new Map<string, string>();
  for (const r of reports) {
    const keys = new Set<string>();
    for (const t of candidateTokens(transcriptFor(r))) {
      keys.add(t.key);
      if (!surfaceByKey.has(t.key)) surfaceByKey.set(t.key, t.surface);
    }
    providerKeys.push(keys);
  }

  const rows: KeywordRow[] = [];
  for (const [key, surface] of surfaceByKey) {
    const present = providerKeys.map((s) => s.has(key));
    const agreement = present.filter(Boolean).length;
    const inFasit = fasitKeys ? fasitKeys.has(key) : undefined;
    rows.push({ surface, present, agreement, inFasit });
  }
  // Uenighet først (færrest providere), så alfabetisk.
  rows.sort((a, b) => a.agreement - b.agreement || a.surface.localeCompare(b.surface, "no"));
  return { providerNames, rows };
}
