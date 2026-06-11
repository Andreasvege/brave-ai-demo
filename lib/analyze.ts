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

Svar KUN med gyldig JSON, ingen markdown, ingen forklaring.`;

const ANALYSIS_SCHEMA = `{
  "summary": "2-4 setninger om hva samtalen handlet om og utfallet",
  "outcome": "booked_meeting" | "callback" | "not_interested" | "no_answer" | "unclear",
  "inferred_prospect_context": "Hva vi kan utlede om motpartens situasjon og behov",
  "objections": [{ "objection": "innvending som ble håndtert", "handled_well": boolean, "inferred": boolean }],
  "next_steps": ["konkrete neste steg"],
  "sales_tips": [{ "tip": "konkret, handlingsrettet tips", "example_from_call": "sitat fra selgeren" }],
  "suggested_crm_update": {
    "company": string | null,
    "contact_name": string | null,
    "status": string,
    "notes": "forslag til CRM-notat"
  },
  "suggested_meeting": {
    "should_book": boolean,
    "proposed_title": string | null,
    "proposed_duration_minutes": number | null,
    "notes": string | null
  }
}`;

export type Analysis = {
  summary: string;
  outcome: "booked_meeting" | "callback" | "not_interested" | "no_answer" | "unclear";
  inferred_prospect_context: string;
  objections: { objection: string; handled_well: boolean; inferred: boolean }[];
  next_steps: string[];
  sales_tips: { tip: string; example_from_call: string }[];
  suggested_crm_update: {
    company: string | null;
    contact_name: string | null;
    status: string;
    notes: string;
  };
  suggested_meeting: {
    should_book: boolean;
    proposed_title: string | null;
    proposed_duration_minutes: number | null;
    notes: string | null;
  };
};

export async function analyzeTranscript(
  transcript: string,
  notes: string | null
): Promise<Analysis> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Analyser denne samtalen og svar med JSON etter dette skjemaet:

${ANALYSIS_SCHEMA}

=== TRANSKRIPSJON (kun selgerens side) ===
${transcript}

=== KONSULENTENS LIVE-NOTATER ===
${notes?.trim() ? notes : "(ingen notater)"}`,
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  return JSON.parse(text.replace(/```json|```/g, "").trim());
}
