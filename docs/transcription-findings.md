# Transkripsjonsfunn — leverandørevaluering

**Mål:** Velge tale-til-tekst-leverandør for Brave CallAI basert på **norsk kvalitet, latency og pris**. Azure (nåværende) er «grei» men krever Claude-rydding av grammatikk/staving — vi leter etter en leverandør som eliminerer det steget.

**Testfil:** `lydopptak/testopptak1.m4a` (1 min 20 sek, norsk cold call).
**Metrikker:** batch-latency, streaming time-to-first-word (TTF), kost/min, og subjektiv norsk kvalitet (egennavn, fagord, mening bevart).

> Harness: `npm run eval-transcribe <fil>` → `eval-results/<dato>/`. Streaming mates i sanntid (100ms/chunk), så hver streaming-kjøring tar ~lydlengden.

## Status

| Provider | Batch | Streaming | Kvalitet (norsk) | Verifisert |
|---|---|---|---|---|
| Azure | ✅ | ✅ | God allrounder, men «o. k.», småfeil | **Ja** |
| AWS Transcribe | ✅ | ✅ | **Best** — korrekte egennavn, naturlig | **Ja** |
| Deepgram (nova-2) | ✅ | ✅ | Svak — egennavn/mening feiler | **Ja** |
| Deepgram (nova-3) | ✅ | ✅ | **Batch: nær AWS.** Streaming svak. Egennavn feiler | **Ja** |
| Google Chirp | kode klar | kode klar | — | ❌ venter nøkkel |
| OpenAI Whisper | kode klar | n/a | — | ❌ venter nøkkel (parkert: egne penger) |

## Metrikk (testfila)

| Provider | Batch (ms) | Streaming TTF (ms) | Kost/min | 200 kall/mnd à 5 min |
|---|---|---|---|---|
| Azure | 2 940 | 1 916 | $0.0170 | $17.00 |
| AWS Transcribe | 43 365 | 1 767 | $0.0240 | $24.00 |
| Deepgram (nova-2) | 2 776 | 4 250 | $0.0059 | $5.90 |
| Deepgram (nova-3) | 2 262 | 4 532 | $0.0059 | $5.90 |
| Google Chirp | — | — | $0.0160 | $16.00 |
| OpenAI Whisper | — | — | $0.0060 | $6.00 |

## Funn per leverandør

### AWS Transcribe — best kvalitet
- Korrekte egennavn («Brave Media», «Elkjøp»), naturlig «OK» og klokkeslett. Minst behov for Claude-rydding.
- Beste streaming-TTF (~1,8s).
- **Svakhet:** ingen ekte rask-batch uten S3 — vår «batch» går via streaming og tar ~43s (nesten lydlengden). Relevant for «hjelp etter samtale»-flyten.
- **Dyrest** ($24/mnd).
- Språkkode: `no-NO` (ikke `nb-NO`).

### Azure — solid allrounder (nåværende)
- Treffer mening godt, men kosmetiske feil: «o. k.» i stedet for «OK», småfeil i grammatikk → krever Claude-rydding (selve motivasjonen for evalueringen).
- Klart raskest batch (~3s) og god TTF (~1,9s).
- Midt på pris ($17/mnd).

### Deepgram — billigst; nova-3 løfter batch-kvaliteten markant
- **nova-2 (gammel):** mening-endrende feil — «beslutningstaker»→«budsjettering», «prospekting» droppet, egennavn rotet. Diskvalifiserende.
- **nova-3 (ny):** fikser de verste batch-feilene — «beslutningstaker» ✅ og «prospekting» ✅ nå korrekte. Batch-kvalitet **nær AWS** til ¼ av prisen, og rask batch (2,3s vs AWS 43s).
- **Gjenstående svakheter (nova-3):**
  - Egennavn fortsatt feil: «Braie/Breva Media» (Azure/AWS treffer «Brave Media»). Deepgrams svakhet på norsk — men kan ryddes av Claude med kontekst fra notater.
  - Streaming svakere enn batch («beslutningstaker»→«puslespillsdager») og **TTF 4 532 ms** — ~2,5× tregere enn Azure/AWS.
- **Vurdering:** batch nova-3 er nå en reell kandidat (kvalitet/pris). Streaming: nei.

## Foreløpig konklusjon
- **AWS** vinner kvalitet + TTF, taper på batch-latency og pris.
- **Azure** er den trygge allrounderen, men løser ikke rydde-problemet.
- **Deepgram nova-3 batch** er nå en reell kandidat: nær AWS-kvalitet, rask batch, lavest pris ($5,90). Svakhet: egennavn + treg/svak streaming.
- Gjenstår: Google Chirp. OpenAI Whisper parkert (krever egne penger).

## Gotchas (løst i koden)
- Streaming **må** mates i sanntid (100ms/chunk) — raskere mating avkutter transkript og fikk Azure til å henge på `EndOfStream`.
- `@deepgram/sdk` pinnet til v3 (v5 er regenerert API uten `createClient`/`listen.live`).
- AWS språkkode er `no-NO`, ikke `nb-NO`.
- Google synkron batch (`recognize`) har 60s-grense; testfila er ~80s → bruk <60s-klipp for Google batch (streaming tåler full lengde).
