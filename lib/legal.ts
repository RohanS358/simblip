// The single source for SIMBLIP's terms and privacy copy.
//
// The first-run terms checklist, the Settings privacy panel, and any public
// route all render from these structures, so the text a user agrees to and the
// text they can re-read later can never drift apart.
//
// Keep this factual. Every claim below was checked against the code:
// sessions live in localStorage (lib/auth/store.ts), data goes to the
// self-hosted Postgres gateway (app/api/pg), files to blob storage, realtime
// through Redis, AI to a self-hosted Ollama host — or OpenRouter when the
// operator sets AI_BACKEND=openrouter (lib/ai/generate.ts) — and web pages
// opened in a Web tab are fetched through /api/web-proxy.

/**
 * Bump when the terms change materially. Users who accepted an older version
 * are re-prompted; the gate (lib/store/consent.ts) compares against this.
 */
export const TERMS_VERSION = '2026-09-27'

/** Bump when the privacy policy changes materially. */
export const PRIVACY_VERSION = '2026-09-27'

/** Human-readable effective date shown alongside the version strings. */
export const EFFECTIVE_DATE = 'September 27, 2026'

/**
 * The terms a new account confirms one by one. Each is a separate, deliberate
 * acknowledgement rather than a single "I agree" — an institution provisions
 * these accounts, so the user should see exactly what applies to them.
 */
export interface TermsItem {
  id: string
  title: string
  body: string
}

export const TERMS_ITEMS: readonly TermsItem[] = [
  {
    id: 'account',
    title: 'This account belongs to your institution',
    body:
      'Your school or organization created this account and can reassign, suspend, or delete it. Admins can see the notebooks, assignments, and submissions you create inside their institution. Keep your password to yourself — anything done from this account is treated as done by you.',
  },
  {
    id: 'academic',
    title: 'Your work is your own',
    body:
      'You keep ownership of the notebooks, simulations, and submissions you make. You grant SIMBLIP only the permission needed to store, display, and sync that work for you and the people you share it with.',
  },
  {
    id: 'ai',
    title: 'AI-generated simulations need checking',
    body:
      'SIMBLIP can build simulations from a written prompt. The model gets things wrong. Treat what it produces as a draft to verify, not an answer — and follow your institution\'s rules on using AI for graded work. AI output is not guaranteed to be original or free of other people\'s rights; check before you publish or submit it as your own.',
  },
  {
    id: 'education',
    title: 'Simulations are teaching models',
    body:
      'SIMBLIP\'s physics, circuit, finance and other models are simplified for learning. Do not rely on them for engineering, safety, medical, legal or financial decisions — verify anything that matters against a qualified source or professional.',
  },
  {
    id: 'age',
    title: 'Younger students use SIMBLIP through their school',
    body:
      'If you are under 16 — or under the age of digital consent where you live — your institution is responsible for getting any permission your parent or guardian must give before you use SIMBLIP.',
  },
  {
    id: 'conduct',
    title: 'Shared spaces stay usable',
    body:
      'Room boards, shared pages, and the component library are shared with other people. Do not upload content you have no right to share, and do not use SIMBLIP to harass anyone or to disrupt someone else\'s session.',
  },
  {
    id: 'data',
    title: 'You know what is stored',
    body:
      'SIMBLIP stores your account details, your notebook content, and a record of the devices you sign in on. Your session is kept in this browser\'s local storage. The privacy policy in Settings lists every category in full.',
  },
  {
    id: 'availability',
    title: 'Service is provided as-is',
    body:
      'SIMBLIP is provided without warranty, and access can be interrupted for maintenance or by your institution. Keep your own copy of anything you cannot afford to lose — Settings has an export.',
  },
] as const

/** A category of data the app holds, as shown in the privacy policy. */
export interface DataCategory {
  id: string
  title: string
  /** What is collected. */
  what: string
  /** Why it is collected. */
  why: string
  /** Where it physically goes. */
  where: string
  /** How long it stays. */
  retention: string
}

export const DATA_CATEGORIES: readonly DataCategory[] = [
  {
    id: 'identity',
    title: 'Account and identity',
    what:
      'Your full name, email address, role, department, and a scrypt hash of your password. Created by your institution admin, not by you.',
    why: 'To sign you in, to show your name to classmates and teachers, and to decide what you can access.',
    where: 'The SIMBLIP Postgres database, self-hosted by your institution\'s operator.',
    retention: 'Until your institution deletes the account.',
  },
  {
    id: 'content',
    title: 'Notebooks and simulations',
    what:
      'Every page you create: drawings, text, simulation objects, documents, spreadsheets, and slides — plus the files you import.',
    why: 'This is the product. It is stored so your work survives a refresh and reaches the devices you sign in on.',
    where:
      'Your browser\'s local storage for the working copy, and the SIMBLIP database and blob storage for the synced copy.',
    retention: 'Until you delete the page, or your institution deletes the account.',
  },
  {
    id: 'coursework',
    title: 'Assignments and submissions',
    what:
      'Assignments set for you, what you submitted, when you submitted it, and any grade or feedback returned.',
    why: 'To run coursework: to show you what is due and to let your teacher review and grade it.',
    where: 'The SIMBLIP database. Visible to the teachers and admins of your institution.',
    retention: 'Until your institution deletes the assignment or the account.',
  },
  {
    id: 'devices',
    title: 'Devices and sessions',
    what:
      'A record of each device you sign in on — a generated device id, a label, and when it last synced. Your session token is held in this browser.',
    why: 'To sync files between your own devices and to let you sign a lost device out.',
    where:
      'Your browser\'s local storage for the session, the SIMBLIP database for the device list, and Redis for short-lived sync state.',
    retention:
      'Sessions expire and refresh automatically. Device records stay until you remove the device or the account is deleted.',
  },
  {
    id: 'ai',
    title: 'AI prompts',
    what: 'The text you type into the AI assistant and the simulation it returns.',
    why: 'To turn your description into a working simulation.',
    where:
      'Sent to the model host configured by your operator. In the standard deployment that is an Ollama machine the operator runs. If the operator switches on the OpenRouter backend instead, prompts go to OpenRouter and the model provider it routes them to, under their terms — some free models there may log prompts. Do not put personal information in AI prompts.',
    retention: 'Processed for the request. The resulting simulation is saved with your page.',
  },
  {
    id: 'web',
    title: 'Web pages you open',
    what: 'The address of any website you open in a Web tab, and the page it returns.',
    why: 'So outside sites can be shown inside your notebook.',
    where:
      'Fetched by the SIMBLIP server on your behalf, then by the site you asked for — that site sees the SIMBLIP server, not your browser. Those sites have their own terms and privacy policies.',
    retention: 'Not stored by SIMBLIP beyond the request. The address is saved with the page.',
  },
  {
    id: 'reports',
    title: 'Bug reports and privacy requests',
    what:
      'What you type into a bug report, plus your account id, the page you sent it from, and your browser and screen details. Privacy requests carry only your account id and the request.',
    why: 'So the problem can be reproduced and fixed.',
    where: 'The SIMBLIP database, readable by the platform operator.',
    retention: 'Until the report is resolved and cleared.',
  },
  {
    id: 'analytics',
    title: 'Product analytics — optional',
    what:
      'Aggregate page views and performance timings via Vercel Analytics. No cookies, and no attempt to identify you personally.',
    why: 'To see which parts of SIMBLIP are used and which are slow.',
    where: 'Vercel. Only ever loaded if you turn it on — it is off until you do.',
    retention: 'Per Vercel\'s retention policy. Turn it off any time in Settings.',
  },
] as const

/** Things SIMBLIP deliberately does not do — stated plainly. */
export const PRIVACY_COMMITMENTS: readonly string[] = [
  'SIMBLIP does not sell your data, and does not share it with advertisers.',
  'SIMBLIP sets no advertising or tracking cookies. Sign-in uses this browser\'s local storage instead.',
  'Your notebook content is never used to train a public AI model.',
  'Nothing in your notebook is shared outside your institution unless you share it yourself.',
] as const

/**
 * Where the app keeps things on this device. Shown in the storage notice so
 * the claim "we use local storage" is specific rather than hand-waved.
 */
export const LOCAL_STORAGE_USES: readonly { title: string; body: string }[] = [
  {
    title: 'Staying signed in',
    body: 'Your session token, so a refresh does not sign you out. Required — clearing it signs you out.',
  },
  {
    title: 'Your notebooks',
    body: 'A working copy of your pages, so the editor opens instantly and keeps working offline.',
  },
  {
    title: 'Your preferences',
    body: 'Theme, dock position, pen feel, and the other settings on this device.',
  },
] as const
