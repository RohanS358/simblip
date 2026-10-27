// An exact scene for the commonest engineering-economics question — pay X now, receive Y a year for N years at r%.
// A small scene model writes the cash-flow card's spec with a syntax slip often enough that the one picture a finance
// question needs went missing, so (like circuit recipes) the script is written here when the request states those numbers
// outright. Anything it cannot read in full is left to the model. Pure: text in, SimScript or null out.

const num = (s: string) => Number(s.replace(/,/g, ''))
const n = String.raw`(\d[\d,]*(?:\.\d+)?)`

export function cashflowRecipe(request: string): string | null {
  const t = request.replace(/\bRs\.?|₹|\$|£|€|USD|INR/gi, ' ')
  if (/\b(kg|g|m\/s|newtons?|degrees?|ohms?|volts?|metres?|meters?|incline|ramp|friction)\b|°/i.test(t)) return null // physics, not money
  if (!/\b(cash ?flow|npv|present worth|net present|annual worth|annuity|payback|interest|salvage|invest(?:ment)?|marr)\b/i.test(t)) return null
  const cost = new RegExp(String.raw`\b(?:pay|pays|paid|cost|costs|invest(?:s|ment)?(?: of)?|spend|buy|purchase|initial(?: cost)?)\b[^\d]{0,25}${n}`, 'i').exec(t)
  const each = new RegExp(String.raw`\b(?:receive|receives|return|returns|earn|earns|income|inflow|save|saves|savings|revenue|benefit)\b[^\d]{0,25}${n}[^.;]{0,20}\b(?:each|every|per|a|/)\s*(?:year|yr|annum)`, 'i').exec(t)
  const years = /\bfor\s+(?:years?\s+1\s+(?:to|through|-)\s+)?(\d+)\s*(?:years?|yrs?)\b|\byears?\s+1\s+(?:to|through|-)\s+(\d+)\b|\b(\d+)\s*[- ]?(?:years?|yrs?)\s+(?:life|period|horizon)/i.exec(t)
  const rate = /(\d+(?:\.\d+)?)\s*%/.exec(t)
  const salvage = new RegExp(String.raw`\bsalvage(?: value)?(?: of| is)?\s*${n}`, 'i').exec(t)
  const periods = years ? Number(years[1] ?? years[2] ?? years[3]) : NaN
  if (!cost || !each || !Number.isFinite(periods) || periods < 1 || periods > 60) return null
  const spec = {
    description: 'Cash flow',
    marr: rate ? Number(rate[1]) : 10,
    discrete: [{ t: 0, amount: -num(cost[1]) }],
    annuities: [{ start: 0, periods, every: 1, amount: num(each[1]) }],
    salvage: salvage ? num(salvage[1]) : 0,
  }
  return `var cf = create("cashflow", { name: "cf", spec: ${JSON.stringify(spec)} });`
}
