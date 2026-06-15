import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `Du er en erfaren norsk salgscoach som analyserer cold calls.

VIKTIG KONTEKST: Du får KUN selgerens side av samtalen (motparten er ikke
tatt opp). Bruk selgerens spørsmål, svar og reaksjoner til å utlede hva
motparten sannsynligvis sa. Marker tydelig hva som er utledet vs. eksplisitt.

Du får også konsulentens egne live-notater fra samtalen, som en egen seksjon.
Notatene beskriver ofte hva motparten sa — siden transkriptet er én-sidet, er
notatene kritisk kontekst. Vekt dem tungt når du utleder motpartens situasjon,
innvendinger og utfall.

Før du begynner; transkriber samtalen på nytt og bruk din versjon som utgangspunkt for analysen du gjør. 
Rett opp i stavefeil, gramatiske feil og annet. 
Du trenger ikke legge ved hva du antar at motparten sier, dette er kun en-sidig. Ikke legg ved "motparten svarer".
Målet er at vi skal ha et så fullverdig transkript av vår side av samtalen som mulig.
Hvis noe er utydelig så velger du å bruke '...' fremfor å omskrive fullstendig. 
Denne versjonen av transkriptet kalles herved V2.

Svar KUN med gyldig JSON, ingen markdown, ingen forklaring.`;

const ANALYSIS_SCHEMA = `{
  "summary": "2-4 setninger om hva samtalen handlet om og utfallet. 
              Trenger ikke å inneholde mye om hva hensikten til selgeren var eller hva dem gjorde, men heller fokus på hvordan det gikk og hva kunden sa",
  "outcome": "booked_meeting" | "callback" | "not_interested" | "no_answer" | "unclear",
  "transcriptionScoreV2" : number - "gi en score på V2-transkriptet fra 1 til 100. Scoren baseres kun på lesbarheten (dvs. kvaliteten på transkripsjonen). Vær brutalt ærlig og realistisk." 
  "transcriptionScoreV1" : number - "gi en score på V1-transkriptet fra 1 til 100. Scoren baseres kun på lesbarheten (dvs. kvaliteten på transkripsjonen). Vær brutalt ærlig og realistisk." 
  "inferred_prospect_context": "Hva vi kan utlede om motpartens situasjon og behov",
  "objections": [{ "objection": "innvending som ble håndtert", "handled_well": boolean, "inferred": boolean }],
  "next_steps": ["konkrete neste steg"],
  "sales_tips": [{ "tip": "konkret, handlingsrettet tips", "example_from_call": "sitat fra selgeren" }],
  "suggested_crm_update": {
    "company": string | null,
    "contact_name": string | null,
    "contact_role": string | null,
    "phone_number": number | null,
    "status": string,
    "notes": "forslag til CRM-notat"
  },
  "suggested_meeting": {
    "should_book": boolean,
    "proposed_title": string | null,
    "proposed_duration_minutes": number | null,
    "notes": string | null
  },
  "transcriptV2": string
}`;

export type Analysis = {
  summary: string;
  outcome: "booked_meeting" | "callback" | "not_interested" | "no_answer" | "unclear";
  transcriptionScoreV1: number;
  transcriptionScoreV2: number;
  inferred_prospect_context: string;
  objections: { objection: string; handled_well: boolean; inferred: boolean }[];
  next_steps: string[];
  sales_tips: { tip: string; example_from_call: string }[];
  suggested_crm_update: {
    company: string | null;
    contact_name: string | null;
    contact_role: string | null,
    phone_number: number | null,
    status: string;
    notes: string;
  };
  suggested_meeting: {
    should_book: boolean;
    proposed_title: string | null;
    proposed_duration_minutes: number | null;
    notes: string | null;
  };
  transcriptV2: string;
};

export async function analyzeTranscript(
  transcript: string,
  notes: string | null,
  extraContext?: string //
): Promise<Analysis> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 3500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Analyser denne samtalen og svar med JSON etter dette skjemaet:

${ANALYSIS_SCHEMA}

=== TRANSKRIPSJON (kun selgerens side) ===
${transcript}

=== KONSULENTENS LIVE-NOTATER ===
${notes?.trim() ? notes : "(ingen notater)"}

=== TILLEGGSINFORMASJON FRA BRUKER ===
${extraContext?.trim() ? extraContext : "(ingen tilleggsinformasjon)"}`,
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  return JSON.parse(text.replace(/```json|```/g, "").trim());
}
