# Legal audit: 2026-09-27

A 20-point checklist, checked against the code. This is not legal advice. The "Lawyer" section lists what needs one.

| # | Item | Status |
|---|------|--------|
| 1 | Privacy policy | Done. `lib/legal.ts` is the single source. It is shown in Settings → Privacy and publicly at `/legal` (new; it is linked from the login page, the landing footer and the sitemap). |
| 2 | Terms | Done. There is a per-item checklist gate at first sign-in. It is versioned, and the version was bumped to 2026-09-27, so every user is asked to accept again. |
| 3 | Cookie policy | Done. There are no cookies. The `/legal#storage` section and the storage notice cover local storage. |
| 4 | Cookie consent needed? | Covered. Local storage is strictly necessary, so it needs no consent. Vercel Analytics is opt-in and off by default (`ConsentedAnalytics`). |
| 5 | Consent on forms collecting personal data | Covered. Accounts are created by the institution (there is no public sign-up). The bug report dialog says it attaches browser and screen details. |
| 6 | What data is collected | Done. `DATA_CATEGORIES` covers it. This audit added "Web pages you open" (the web proxy) and privacy requests. |
| 7 | Why each item is collected | Done. Each category has a "why" field. |
| 8 | Data deletion request | New: a "Delete my account and data" button in Settings → Privacy. It files into `simblip_bug_reports` and the operator reads it on `/dev`. **There is no admin tool that deletes accounts yet, so these requests are handled by hand.** |
| 9 | Data access or correction | New: "Send me a copy" and "Correct my data" buttons, handled the same way. Notebooks can also be exported from Settings. |
| 10 | Third-party API terms | See the notes below: OpenRouter, Google search in Web tabs, Vercel. |
| 11 | AI output and IP | Added to the AI terms item: output is not guaranteed to be original. Users must check it before publishing or submitting it. |
| 12 | Open-source licenses | Checked 433 production packages. None are blocking (details below). `scripts/third-party-licenses.mjs` runs at prebuild and fails the build if an unreviewed copyleft license appears. |
| 13 | Copyrighted assets | Moved 5 university syllabus PDFs, plus `performance.pdf` and `__t-flow.json`, from `public/` (where they were served publicly) to `docs/reference/`. |
| 14 | Attribution | `/third-party-licenses.txt` is generated at build and linked from `/legal#licenses`. It includes the vendored x-data-spreadsheet and the Plus Jakarta Sans font. |
| 15 | UI assets | Fonts are OFL (Plus Jakarta Sans, Geist). Icons come from lucide (ISC). Covers and docs screenshots are self-made. |
| 16 | Age restrictions | Added a terms item: for under-16s, the institution obtains parental consent. |
| 17 | High-risk advice disclaimer | Added "Simulations are teaching models": not for engineering, safety, medical, legal or financial decisions. |
| 18 | Refund policy | Users are never charged. `/legal` says fees, refunds and cancellation are set by the institution's license agreement. |
| 19 | Marketing claims | Fixed the landing claim "on-device AI… Nothing leaves your machine", which was false: the AI runs on the server, or on OpenRouter. |
| 20 | Final audit | This document. |

## Fixed in passing
- **The web proxy was an open proxy** that stripped framing headers. Anyone could serve any site, including phishing pages, under `simblip.rohan-singh.com.np` by sending a link. It now refuses requests that did not come from a SIMBLIP page (checked with `Sec-Fetch-Site` and `Referer`).

## Notes on dependencies
- GSAP uses its "standard no-charge" license. It is free for commercial use, but it bars use in tools that compete with Webflow's visual site builder. SIMBLIP is not such a tool.
- sharp/libvips is LGPL, dynamically linked and server-only. jszip is used under MIT and dompurify under Apache. @vercel/analytics (MPL) is used unmodified.
- **Security (not a legal issue):** `npm audit` reports 1 critical and 8 high findings. Next 16.0.10 has a critical advisory (upgrade to at least 16.3.6). `xlsx` 0.18.5 has prototype pollution and ReDoS and no fix on npm; SheetJS now ships from its own CDN.

## Needs a lawyer
1. **Jurisdiction and governing law.** The terms name neither. Nepal's Individual Privacy Act 2075 applies. GDPR and India's DPDP apply if institutions outside Nepal sign up.
2. **Institution license agreement / DPA.** The terms assume institutions are the data controllers and SIMBLIP is a processor. That needs a written data processing agreement with each institution.
3. **Minors.** The claim "the institution gets parental consent" only holds if the license agreement makes the institution responsible for it.
4. **OpenRouter free models.** Some providers log prompts or train on them. If production uses `AI_BACKEND=openrouter` with student users, check whether this is acceptable. Also consider a paid, zero-retention route.
5. **Web tabs proxying Google search and third-party sites.** Google's ToS restricts automated access and reframing. Proxied sites' copyright stays with them.
6. **`public/100_Questions_All_Subjects.md`** is still served publicly. If it is copied from a university question bank, move it out of `public/` (tests read it from that path).
7. **Contact addresses.** The landing page uses `licensing@simblip.app`, but the real domain is `rohan-singh.com.np`. Confirm you control that mailbox. A privacy policy also needs a named operator and a contact address, which `/legal` does not have yet.
8. **Consent audit trail.** Terms acceptance is stored only on the client (see the `ponytail:` note in `lib/store/consent.ts`). You may need a record on the server of who accepted which version.
