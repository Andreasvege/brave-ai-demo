// Tekstnormalisering + WER/CER for kvalitetsscoring mot håndskrevet fasit.
// Bevisst enkelt: lowercase, fjern tegnsetting, map norske tallord → siffer.
// Caveat: sammensatte talluttrykk ("tjue tre" vs "23") matcher ikke perfekt — skriv
// tall som siffer i fasiten for minst støy. WER straffer alle ordfeil likt, så den
// fanger IKKE egennavn-vekting — bruk nøkkelord-matrisa (nokkelord.md) til det.

const NUMBER_WORDS: Record<string, string> = {
  null: "0", en: "1", ett: "1", to: "2", tre: "3", fire: "4", fem: "5",
  seks: "6", sju: "7", syv: "7", åtte: "8", ni: "9", ti: "10", elleve: "11",
  tolv: "12", tretten: "13", fjorten: "14", femten: "15", seksten: "16",
  sytten: "17", atten: "18", nitten: "19", tjue: "20", tretti: "30",
  førti: "40", femti: "50", seksti: "60", sytti: "70", åtti: "80",
  nitti: "90", hundre: "100", tusen: "1000",
};

// Lowercase, bytt alt som ikke er bokstav/tall/æøå med mellomrom, splitt, map tallord.
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^0-9a-zæøå]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => NUMBER_WORDS[w] ?? w);
}

// Levenshtein-avstand over to sekvenser (ord eller tegn), to-rad DP.
function levenshtein<T>(a: T[], b: T[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

// Word Error Rate: ordfeil / antall ord i fasit. null hvis fasit eller hyp er tom.
export function wer(reference: string, hypothesis: string): number | null {
  const ref = tokenize(reference);
  const hyp = tokenize(hypothesis);
  if (ref.length === 0 || hyp.length === 0) return null;
  return levenshtein(ref, hyp) / ref.length;
}

// Character Error Rate over normalisert tekst (tokens limt med ett mellomrom).
export function cer(reference: string, hypothesis: string): number | null {
  const ref = tokenize(reference).join(" ");
  const hyp = tokenize(hypothesis).join(" ");
  if (ref.length === 0 || hyp.length === 0) return null;
  return levenshtein([...ref], [...hyp]) / ref.length;
}

export function pct(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)} %`;
}
