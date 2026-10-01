// Lab packages — which subject each engine belongs to.
//
// An engine is not a feature of one big "Step Lab"; it is a component of a
// SUBJECT package (Operating Systems, Computer Networks, …). A package is what a
// course ships with and what a user enables, so adding another field of
// engineering later is adding packages (and their engines), never touching a
// shared catalogue. Pure data: no React, no engine code, importable anywhere.
//
// Engines name their `group`; this file says which package owns each group.
// Two groups belong to packages that existed before (digital, dsa) and join them.

export interface LabPackage {
  /** Also the palette domain id. */
  id: string
  name: string
  /** Short palette/settings label. */
  label: string
  description: string
  iconName: string
  /** Palette colour angle (see components/workspace/palette.tsx). */
  hue: number
  /** Course ids (content/courses/<id>) whose figures use this package. */
  courses: string[]
}

export const LAB_PACKAGES: LabPackage[] = [
  { id: 'os', label: 'Operating Systems', name: 'Operating Systems Lab', description: 'CPU scheduling, page replacement, disk scheduling, the banker’s algorithm and memory allocation — one step at a time.', iconName: 'Layers', hue: 215, courses: ['enct-254'] },
  { id: 'architecture', label: 'Architecture', name: 'Computer Architecture Lab', description: 'Caches, floating point, Booth multiplication, pipelines and the 8085 microprocessor.', iconName: 'Cpu', hue: 235, courses: ['enct-303', 'enex-201'] },
  { id: 'datacomm', label: 'Data Communication', name: 'Data Communication Lab', description: 'Line codes, modulation, PCM, Fourier series, CRC and Hamming error control.', iconName: 'Radio', hue: 190, courses: ['enct-253'] },
  { id: 'networks', label: 'Networks', name: 'Computer Networks Lab', description: 'ARQ protocols, subnetting, routing and TCP congestion control.', iconName: 'Network', hue: 175, courses: ['enct-304'] },
  { id: 'toc', label: 'Theory of Computation', name: 'Theory of Computation Lab', description: 'DFA, NFA, pushdown automata, Turing machines and context-free grammars.', iconName: 'Workflow', hue: 305, courses: ['enct-203'] },
  { id: 'numerical', label: 'Numerical Methods', name: 'Numerical Methods Lab', description: 'Root finding, integration, ODE solvers, linear systems, interpolation and finite differences.', iconName: 'Sigma', hue: 60, courses: ['ensh-252'] },
  { id: 'statistics', label: 'Statistics & Data', name: 'Probability, Statistics & Data Lab', description: 'Distributions, Bayes, the central limit theorem, confidence intervals, regression and gradient descent.', iconName: 'ChartScatter', hue: 120, courses: ['ensh-304', 'enct-202'] },
  { id: 'simulation', label: 'Simulation', name: 'Simulation & Modelling Lab', description: 'Monte Carlo, queues, random-number generators and Markov chains.', iconName: 'Dices', hue: 340, courses: ['enct-353'] },
  { id: 'ai', label: 'Artificial Intelligence', name: 'Artificial Intelligence Lab', description: 'Search, minimax, perceptrons, clustering, genetic algorithms, neural networks and fuzzy logic.', iconName: 'BrainCircuit', hue: 280, courses: ['enct-351'] },
  { id: 'graphics', label: 'Graphics', name: 'Computer Graphics Lab', description: 'Rasterisation, clipping, 2-D transforms, Bézier curves, 3-D projection and shading.', iconName: 'Shapes', hue: 15, courses: ['enct-201'] },
  { id: 'database', label: 'Databases', name: 'Database Systems Lab', description: 'Functional dependencies and normal forms, relational algebra and serializability.', iconName: 'Database', hue: 100, courses: ['enct-301'] },
  { id: 'control', label: 'Control Systems', name: 'Control & Block Diagram Lab', description: 'Simulink-style block diagrams: step, PID, transfer functions and feedback, with overshoot and settling readouts.', iconName: 'SlidersHorizontal', hue: 45, courses: ['enct-353'] },
]

/** Engine group → owning package id. */
const GROUP_PACKAGE: Record<string, string> = {
  'Operating systems': 'os',
  'Computer organisation': 'architecture',
  'Microprocessors': 'architecture',
  'Data communication': 'datacomm',
  'Computer networks': 'networks',
  'Theory of computation': 'toc',
  'Numerical methods': 'numerical',
  'Probability, statistics & data': 'statistics',
  'Simulation & modelling': 'simulation',
  'Artificial intelligence': 'ai',
  'Computer graphics': 'graphics',
  'Databases': 'database',
  'Systems & control': 'control',
  // joins the existing packages
  'Digital logic': 'digital',
  'Data structures & algorithms': 'dsa',
}

/** The package an engine ships in. Unknown groups fall back to their own id so a
 *  new engine group never silently vanishes from the palette. */
export const packageOfGroup = (group: string): string => GROUP_PACKAGE[group] ?? group.toLowerCase().replace(/[^a-z0-9]+/g, '-')
