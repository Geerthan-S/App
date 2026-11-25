# AI assistant (OpenAI)

`BLOCKED_EXTERNAL` until an OpenAI API key is configured.

## Turn it on

1. Create an API key in the OpenAI dashboard (a project key with a spending limit).
2. Store it as a Firebase secret and expose it to the functions runtime:
   ```
   firebase functions:secrets:set OPENAI_API_KEY
   ```
   Then bind it to the two AI functions by adding `secrets: ['OPENAI_API_KEY']`
   to their options, or, for a quick pilot, put `OPENAI_API_KEY=...` in
   `functions/.env.doctor-c7c29` (not committed). Redeploy functions.
3. Admin › Feature Flags › **AI assistant** on.
4. Admin › Business Settings › AI assistant: model (default `gpt-4o-mini`),
   free questions per account (default 1), answer length.

Until the key is present, `askAssistant` answers `AI_NOT_CONFIGURED` and no
free question is used.

## Rules built in

- Verified doctors only; one free question per account, then the AI plan
  (Premium & AI Plans) is required.
- A photo can be attached only after the doctor confirms the patient consented
  and the photo shows no face, name or ID. Photos are stored privately under
  `ai/{uid}/` and sent to OpenAI as part of the request.
- Every answer carries the notice "AI decision support only. Verify against
  clinical guidelines and your own examination before acting." Do not market
  the assistant as more accurate than doctors.
- Conversations are private to the doctor (`aiThreads/{uid}`).

## Before launch

- Health data is sensitive personal data under the DPDP Act 2023: update the
  privacy notice to name OpenAI as a processor, and review OpenAI's data
  retention settings for the API (zero-retention options where available).
- Software that suggests diagnoses may fall under medical-device rules; take
  advice before positioning it beyond decision support.
