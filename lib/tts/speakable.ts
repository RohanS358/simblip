// Make written text SPEAKABLE: a neural voice reads "27.3 mA" as letters and "V = IR" as noise, so units,
// symbols and operators are spelled out the way a teacher would say them. Pure.

const UNITS: [RegExp, string][] = [
  [/(\d)\s?kΩ/g, '$1 kilo-ohms'], [/(\d)\s?MΩ/g, '$1 mega-ohms'], [/(\d)\s?Ω/g, '$1 ohms'],
  [/(\d)\s?mA\b/g, '$1 milliamps'], [/(\d)\s?µA\b/g, '$1 microamps'], [/(\d)\s?A\b/g, '$1 amps'],
  [/(\d)\s?mV\b/g, '$1 millivolts'], [/(\d)\s?kV\b/g, '$1 kilovolts'], [/(\d)\s?V\b/g, '$1 volts'],
  [/(\d)\s?mW\b/g, '$1 milliwatts'], [/(\d)\s?kW\b/g, '$1 kilowatts'], [/(\d)\s?W\b/g, '$1 watts'],
  [/(\d)\s?kHz\b/g, '$1 kilohertz'], [/(\d)\s?MHz\b/g, '$1 megahertz'], [/(\d)\s?Hz\b/g, '$1 hertz'],
  [/(\d)\s?µF\b/g, '$1 microfarads'], [/(\d)\s?nF\b/g, '$1 nanofarads'], [/(\d)\s?pF\b/g, '$1 picofarads'],
  [/(\d)\s?mH\b/g, '$1 millihenries'],
  [/(\d)\s?cm\/s\b/g, '$1 centimetres per second'], [/(\d)\s?m\/s²/g, '$1 metres per second squared'], [/(\d)\s?m\/s\b/g, '$1 metres per second'],
  [/(\d)\s?kg\b/g, '$1 kilograms'], [/(\d)\s?cm\b/g, '$1 centimetres'], [/(\d)\s?mm\b/g, '$1 millimetres'], [/(\d)\s?ms\b/g, '$1 milliseconds'], [/(\d)\s?µs\b/g, '$1 microseconds'],
  [/(\d)\s?°C\b/g, '$1 degrees Celsius'], [/(\d)\s?°/g, '$1 degrees'], [/(\d)\s?%/g, '$1 percent'],
]
const SYMBOLS: [RegExp, string][] = [
  [/≈/g, ' is approximately '], [/≠/g, ' is not equal to '], [/≤/g, ' is at most '], [/≥/g, ' is at least '],
  [/×/g, ' times '], [/·/g, ' times '], [/÷/g, ' divided by '], [/→/g, ' gives '], [/−/g, ' minus '],
  [/²/g, ' squared'], [/³/g, ' cubed'], [/√/g, 'square root of '], [/π/g, 'pi'], [/Δ/g, 'change in '], [/Ω/g, ' ohms'], [/µ/g, 'micro'],
  [/\s=\s/g, ' equals '], [/\s\/\s/g, ' over '], [/\s\+\s/g, ' plus '], [/\s-\s/g, ' minus '], [/\s\*\s/g, ' times '],
  [/\bV\s*=\s*IR\b/g, 'V equals I times R'], [/\bI\s*=\s*V\s*over\s*R\b/g, 'I equals V over R'],
]

const LATEX: Record<string, string> = { pi: 'pi', cdot: ' times ', times: ' times ', div: ' divided by ', Delta: 'change in ', delta: 'delta', theta: 'theta', omega: 'omega', Omega: 'ohms', mu: 'mu', lambda: 'lambda', sqrt: 'square root of ', frac: ' ', left: '', right: '', approx: ' is approximately ', leq: ' is at most ', geq: ' is at least ', infty: 'infinity' }

export function speakable(text: string): string {
  let t = text.replace(/\$([^$]+)\$/g, '$1').replace(/\\([a-zA-Z]+)/g, (_, c: string) => ` ${LATEX[c] ?? c} `).replace(/[{}^_]/g, ' ')
  for (const [re, to] of UNITS) t = t.replace(re, to)
  for (const [re, to] of SYMBOLS) t = t.replace(re, to)
  return t.replace(/\s+/g, ' ').replace(/\s([,.;:!?])/g, '$1').trim()
}
