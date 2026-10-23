// "briefly", "to the point", "just the answer" → the short version. Everything else is taught in full, with pictures.

const BRIEF_RE = /\b(?:brief(?:ly)?|to the point|short(?:ly)?|quick(?:ly)?|in a nutshell|summar(?:y|ise|ize)|tl;?dr|just the answer|concise(?:ly)?|crisp)\b/i
export const wantsBrief = (request: string) => BRIEF_RE.test(request)
