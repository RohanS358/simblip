# Bachelor in Computer Engineering — coverage matrix

Tribhuvan University · Institute of Engineering. Generated from `content/curriculum/computer.mjs` by `node scripts/build-curriculum.mjs` — edit that file, not this one.
**249 chapters** · simulation on 134 · diagram on 108 · existing components reused on 158 · existing components enhanced on 41 · new engines on 49.

**Notes written for 21 of 36 subjects.**


Every chapter is put through the six questions:

| # | Question | Meaning |
|---|---|---|
| Q1 | Short & simple? | can it be explained simply and briefly |
| Q2 | Simulation? | can a simulation teach the concept better than prose |
| Q3 | Diagram? | does a flow / sequence / UML / block / animated diagram help |
| Q4 | Reuse | which existing component or engine serves it |
| Q5 | Enhance | which existing component had to be extended |
| Q6 | New | which new component or engine was built |

## Semester 1 · ENSH 101 — Engineering Mathematics I

**Notes:** not written yet (matrix only)


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Derivatives and its Applications | 10 | Y | Y | — | graph, formula, surface3d | — | — | Slope as a tangent you can drag; Newton and gradient descent make the derivative do work. |
| 2. Antiderivatives and its Applications | 11 | Y | Y | — | graph, formula | — | — | Area under a curve as rectangles/trapezoids/parabolas that converge. |
| 3. Ordinary Differential Equations and its Applications | 10 | Y | Y | — | graph, mechanics | — | — | Slope fields as Euler steps; RC and mass-spring as the physical ODEs. |
| 4. Plane Analytic Geometry | 4 | Y | — | — | graph, surface3d | — | — | Conics plotted from their equations with live parameters. |
| 5. Three Dimensional Geometry | 10 | Y | Y | — | surface3d | — | — | Planes and spheres in the 3-D plotter; projection engine for views. |

## Semester 1 · ENCT 101 — Computer Programming

**Notes:** 6 lessons in `content/courses/enct-101/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction to Computer Programming | 3 | Y | — | Y flow | dsa, diagram | — | — | Problem-solving pipeline as a flowchart; compile/link/run as a block diagram. |
| 2. Overview of C Programming | 3 | Y | — | — | dsa | — | — | Structure of a C program run line by line in the DSA Lab. |
| 3. Operators and Expressions | 3 | Y | — | — | dsa | — | — | Precedence and type conversion evaluated step by step. |
| 4. Input and Output | 3 | Y | — | — | dsa | — | — | printf/scanf format strings; output panel narrates. |
| 5. Control Structures | 8 | Y | — | Y flow | dsa, diagram | — | — | if/else and loops: flowchart beside the executing code. |
| 6. Array and Pointer | 7 | Y | — | — | dsa | — | — | Memory blocks and pointer arrows make addresses visible. |
| 7. User-defined Functions | 6 | Y | — | — | dsa | — | — | Call stack and recursion tree in the DSA Lab. |
| 8. Structures | 5 | Y | — | — | dsa | — | — | Struct layout as an object block. |
| 9. File Management | 4 | Y | — | Y flow | diagram | — | — | File modes and the fopen/fread/fclose lifecycle as a flow diagram. |
| 10. Recent Trends in Programming | 2 | Y | — | Y uml | — | diagram2 | — | Procedural vs object-oriented as UML class boxes. |

## Semester 1 · ENME 101 — Engineering Drawing

**Notes:** not written yet (matrix only)

> introduction chapter is untimed in the syllabus

| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Dimensioning | 1 | Y | — | Y 1 | diagram | — | — | Drawing conventions as annotated figures. |
| 2. Geometrical Construction | 2 | Y | Y | — | shapes | — | — | Constructions as ordered steps; Bézier/raster for curves. |
| 3. Basic Descriptive Geometry | 4 | Y | Y | — | surface3d | — | — | Points/lines/planes in 3-D projection. |
| 4. Multi View (Orthographic) Projections | 8 | Y | Y | — | — | — | — | Rotate an object and see the front/top/side projections. |
| 5. Developments and Intersections | 7 | Y | — | Y 1 | shapes | — | — | Unfolding solids drawn as diagrams. |
| 6. Pictorial Drawings | 7 | Y | Y | — | — | — | — | Isometric = parallel projection; perspective compared. |

## Semester 1 · ENEX 101 — Fundamental of Electrical and Electronics Engineering

**Notes:** 1 lessons in `content/courses/enex-101/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Basic Circuits Concepts | 6 | Y | Y | — | circuit, graph | — | — | Already authored: content/courses/enex-101 (Ohm/Kirchhoff on live circuits). |
| 2. Average and RMS Values | 4 | Y | Y | — | circuit, graph | — | — | Scope readouts (RMS/avg) on a live AC source. |
| 3. AC Circuit Analysis | 12 | Y | Y | — | circuit, graph | — | — | RLC on the MNA solver; phasor ideas via transfer-function block diagrams. |
| 4. Diodes | 7 | Y | Y | — | circuit | — | — | Rectifier/clipper on the existing diode model. |
| 5. Transistor | 10 | Y | Y | — | circuit | — | — | BJT/MOSFET switch and amplifier circuits. |
| 6. Operational Amplifier and Oscillator | 6 | Y | Y | — | circuit | — | — | Op-amp circuits live; feedback as a block diagram. |

## Semester 1 · ENSH 102 — Engineering Physics

**Notes:** not written yet (matrix only)


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Oscillation | 6 | Y | Y | — | mechanics, graph | — | — | Existing rigid-body/spring/damper engine. |
| 2. Acoustics | 3 | Y | — | — | formula | — | — | Sabine reverberation as a formula card. |
| 3. Heat and Thermodynamics | 8 | Y | Y | — | heatSource, graph | — | — | Existing thermal solver; heat1d for conduction profiles. |
| 4. Optics | 17 | Y | Y | — | optics | — | — | Existing ray tracer and wave-optics formulas. |
| 5. Electrostatics | 8 | Y | Y | — | charge, efield | — | — | Existing Coulomb and field-region behaviours. |
| 6. Electromagnetism | 6 | Y | Y | — | bfield | — | — | Existing B-field regions and Faraday demo. |
| 7. Electromagnetic Waves | 6 | Y | Y | — | waves | — | — | Existing wave-source/boundary/transmission-line. |
| 8. Photon and Matter Waves | 6 | Y | Y | — | quantum | — | — | Existing quantum well and tunnel barrier. |

## Semester 1 · ENME 106 — Engineering Workshop

**Notes:** not written yet (matrix only)

> practical trade skills: diagrams and tables only — a simulation would teach a false picture

| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Safety Measures in the Workshop | 1 | Y | — | Y flow | diagram | — | — | Decision flowcharts for safety. |
| 2. Bench Work and Fittings | 4 | Y | — | Y 1 | diagram | — | — | Process diagrams; no simulation is honest here. |
| 3. Thread Cutting | 1 | Y | — | Y 1 | diagram | — | — | Labelled diagram. |
| 4. Sheet Metal | 2 | Y | — | Y 1 | diagram | — | — | Development diagrams. |
| 5. Machine Tools | 2 | Y | — | Y 1 | diagram | — | — | Block diagram of a lathe’s parts. |
| 6. Forging and Casting | 1.5 | Y | — | Y flow | diagram | — | — | Process flow. |
| 7. Welding | 2.5 | Y | — | Y 1 | diagram | — | — | Process comparison table. |
| 8. Brazing and Soldering | 1 | Y | — | Y 1 | diagram | — | — | Process comparison table. |

## Semester 2 · ENSH 151 — Engineering Mathematics II

**Notes:** not written yet (matrix only)


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Calculus of Two and More Variables | 6 | Y | Y | — | surface3d | — | — | Partial derivatives on a 3-D surface; 2-variable descent. |
| 2. Multiple Integrals | 7 | Y | Y | — | surface3d | — | — | Volumes as Monte-Carlo and Riemann sums. |
| 3. Vector Calculus | 12 | Y | Y | — | efield, bfield, surface3d | — | — | Existing field regions for divergence/curl intuition. |
| 4. Laplace Transform | 7 | Y | Y | — | formula | — | — | Transfer functions as running block diagrams. |
| 5. Matrices | 8 | Y | Y | — | table | — | — | Elimination and iteration step by step. |
| 6. Solution of Differential Equation in Series and Special Functions | 5 | Y | Y | — | graph | — | — | Compare series and numeric solutions. |

## Semester 2 · ENCT 151 — Object Oriented Programming

**Notes:** 4 lessons in `content/courses/enct-151/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction to Object Oriented Programming | 3 | Y | — | Y uml | — | diagram2 | — | Objects, classes, messages as UML class boxes. |
| 2. Basics of C++ Programming | 5 | Y | — | Y seq | dsa | — | — | References and new/delete run in the DSA Lab; overload resolution shown as a sequence (the Lab interpreter does not resolve overloads or default arguments yet). |
| 3. Objects and Classes | 7 | Y | — | Y uml,seq | dsa | diagram2 | — | Encapsulation and constructors run in the lab; destructor order drawn as a sequence (no destructors in the Lab interpreter). |
| 4. Operator Overloading | 5 | Y | — | Y seq | — | diagram2 | — | a + b as a method-call sequence (the Lab interpreter has no operator overloading). |
| 5. Inheritance | 5 | Y | — | Y uml,seq | — | diagram2 | — | UML inheritance diagram + constructor order as a sequence (Lab interpreter lacks inheritance). |
| 6. Virtual Functions | 4 | Y | — | Y uml,seq | — | diagram2 | — | vtable dispatch as an animated sequence (Lab interpreter lacks virtual functions). |
| 7. Stream Computation | 6 | Y | — | Y flow | dsa, diagram | — | — | Stream class hierarchy diagram. |
| 8. Templates | 6 | Y | — | Y seq | — | — | — | Instantiation shown as a compiler sequence (Lab interpreter lacks templates). |
| 9. Exception Handling | 4 | Y | — | Y flow | dsa, diagram | — | — | throw/catch unwinding as flow. |

## Semester 2 · ENEX 152 — Digital Logic

**Notes:** 6 lessons in `content/courses/enex-152/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction | 5 | Y | Y | — | circuit | — | — | Codes and complements converted step by step. |
| 2. Logic Gates | 3 | Y | Y | — | circuit, truthtable | — | — | Live gates and truth tables (existing). |
| 3. Boolean Algebra and K-Maps | 4 | Y | Y | — | truthtable | — | — | K-map minimiser with groups. |
| 4. Combinational Logic Circuits | 8 | Y | Y | — | circuit, truthtable | — | — | Adders/mux/decoders as real circuits (adders lesson exists). |
| 5. Sequential Logic Circuits | 5 | Y | Y | — | circuit | — | — | Flip-flops on the live logic solver. |
| 6. Registers and Counters | 7 | Y | Y | — | circuit, graph | — | — | Registers/counters with timing graphs. |
| 7. Sequential Machine Designs | 8 | Y | Y | — | circuit | — | — | State diagrams simulated by the automaton engine. |
| 8. Digital Integrated Circuits | 5 | Y | Y | — | circuit | — | — | CMOS/TTL switching circuits. |

## Semester 2 · ENEX 151 — Electronic Device and Circuits

**Notes:** not written yet (matrix only)


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. The Bipolar Junction Transistor (BJT) | 9 | Y | Y | — | circuit | — | — | Existing BJT. |
| 2. Field-Effect Transistor | 10 | Y | Y | — | circuit | — | — | Existing MOSFET. |
| 3. Operational Amplifier Circuits and Oscillator | 10 | Y | Y | — | circuit | — | — | Op-amp + feedback block diagram. |
| 4. Output Stages and Power Amplifiers | 10 | Y | Y | — | circuit | — | — | Push-pull stages. |
| 5. Power Supplies, Breakdown Diodes, and Voltage Reference | 6 | Y | Y | — | circuit | — | — | Rectifier + zener regulator. |

## Semester 2 · ENSH 153 — Engineering Chemistry

**Notes:** not written yet (matrix only)

> chemistry is descriptive; the app has no chemistry engine, so only the quantitative parts are simulated

| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Electrochemistry and Buffer | 8 | Y | — | Y 1 | formula, chart | — | — | Nernst/pH as formula + chart; honest diagrams. |
| 2. Catalyst and Catalysis | 4 | Y | — | Y 1 | diagram | — | — | Energy-profile diagram. |
| 3. Analytical Techniques and their Applications | 6 | Y | — | Y 1 | chart, diagram | — | — | Instrument block diagrams. |
| 4. Metal Complexes, Rare Earth Elements and Metal alloys | 6 | Y | — | Y 1 | table | — | — | Tables/diagrams. |
| 5. Sustainable Chemistry | 7 | Y | — | Y flow | diagram | — | — | Process flows. |
| 6. Nanoscience and Nanotechnology | 3 | Y | Y | — | quantum | — | — | Quantum confinement (existing well). |
| 7. Engineering Materials | 7 | Y | — | Y 1 | table | — | — | Property tables. |
| 8. Explosives, Lubricants and Paints | 4 | Y | — | Y 1 | table | — | — | Tables. |

## Semester 2 · ENEE 154 — Electrical Circuits and Machines

**Notes:** not written yet (matrix only)


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Transients in Electric Circuit | 7 | Y | Y | — | circuit, graph | — | — | RC/RL on the MNA transient solver. |
| 2. Transient Analysis R-L-C Circuit by Classical Method | 10 | Y | Y | — | circuit, graph | — | — | Damping cases live. |
| 3. Transient Analysis Using Laplace Transform | 7 | Y | Y | — | — | — | — | Step response of transfer functions in the block simulator. |
| 4. Network Transfer Function and Frequency Response | 8 | Y | Y | — | graph | — | — | Block diagrams with gain/tf and scopes. |
| 5. Two-Port Parameters of Network | 8 | Y | — | Y block | circuit | — | — | Two-port as a block diagram + circuit. |
| 6. Magnetic Circuit and Induction | 3 | Y | Y | — | bfield | — | — | Existing fields. |
| 7. Transformers | 6 | Y | Y | — | circuit | — | — | Existing transformer. |
| 8. DC Machine | 5 | Y | Y | — | dc-machine | — | — | Existing dc-machine. |
| 9. AC Motor | 6 | Y | Y | — | induction-motor | — | — | Existing induction motor. |

## Semester 3 · ENSH 201 — Engineering Mathematics III

**Notes:** not written yet (matrix only)


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Fourier Series and Fourier Transform | 12 | Y | Y | — | graph | — | — | Harmonics summed live; Gibbs overshoot. |
| 2. Functions of Complex Variable | 12 | Y | — | — | surface3d, formula | — | — | Mappings on the 3-D plotter. |
| 3. Partial Differential Equations | 5 | Y | Y | — | graph | — | — | Heat equation by finite differences. |
| 4. Modelling through Partial Differential Equation | 10 | Y | Y | — | waves | — | — | Wave and heat models. |
| 5. Z- transform and its Applications | 6 | Y | Y | — | — | — | — | Discrete blocks (delay, gain, sum) in the simulator. |

## Semester 3 · ENSH 204 — Communication English

**Notes:** not written yet (matrix only)

> language skills: diagrams and worked examples; no simulation

| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Technical Communication | 2 | Y | — | Y flow | diagram | — | — | Communication model as a block diagram. |
| 2. Writing Skills | 8 | Y | — | Y 1 | diagram | — | — | Structure diagrams. |
| 3. Technical Writing | 15 | Y | — | Y flow | diagram | — | — | Report structure flows. |
| 4. Business Correspondence | 10 | Y | — | Y 1 | diagram | — | — | Templates. |
| 5. Listening and Oral Communication | 4 | Y | — | Y 1 | diagram | — | — | Process diagrams. |
| 6. Use of Visual Aids in Communication | 6 | Y | — | Y 1 | chart | — | — | Chart types compared (existing chart). |

## Semester 3 · ENCT 201 — Computer Graphics and Visualization

**Notes:** 7 lessons in `content/courses/enct-201/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction and Application | 4 | Y | — | Y flow | — | diagram2 | — | Graphics pipeline as an animated flow. |
| 2. Raster Graphics and Algorithms | 9 | Y | Y | — | — | — | raster, clip | DDA/Bresenham/circle/fill and clipping, pixel by pixel. |
| 3. 2D and 3D Coordinate Systems and Viewing Transformations | 9 | Y | Y | — | — | — | transform2d, project3d | Homogeneous matrices and projections. |
| 4. Curve Modeling and Surface Modelling | 4 | Y | Y | — | surface3d | — | bezier | de Casteljau; surfaces in the 3-D plotter. |
| 5. Visible Surface Determination | 4 | Y | — | Y flow | diagram | — | — | Z-buffer as a flow + worked table. |
| 6. Illumination and Surface Rendering Methods | 4 | Y | Y | — | — | — | phong | Ambient/diffuse/specular curves. |
| 7. Computer Animation and Visualization | 5 | Y | Y | Y anim | — | diagram2 | — | Keyframes as animated diagrams; interpolation curves. |
| 8. Latest Trends in Computer Graphics | 6 | Y | — | Y flow | diagram | — | — | Pipeline diagrams for AR/VR. |

## Semester 3 · ENCT 202 — Foundation of Data Science

**Notes:** 7 lessons in `content/courses/enct-202/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction to Data Science | 3 | Y | — | Y flow | diagram | — | — | Lifecycle as a loop diagram. |
| 2. Mathematics for Data Science | 10 | Y | Y | — | table | — | gd, dist, clt, confint | Gradient descent, distributions, CLT, intervals. |
| 3. Data Understanding and Preprocessing | 10 | Y | — | Y flow | table, chart | — | — | Cleaning pipeline; before/after tables. |
| 4. Data Analysis | 8 | Y | — | — | chart, table | — | — | Charts and summaries (existing chart/table). |
| 5. Regression and Predictive Modeling | 5 | Y | Y | — | — | — | regression | Least squares with residuals. |
| 6. Modeling and Validation Processes | 6 | Y | Y | — | — | — | — | Learning loops; validation as a diagram. |
| 7. Ethics and Recent Trends | 3 | Y | — | Y flow | diagram | — | — | Responsible-data flow. |

## Semester 3 · ENCT 203 — Theory of Computation

**Notes:** 6 lessons in `content/courses/enct-203/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction to Formal Language, Logic and Proof | 7 | Y | — | Y flow | diagram | — | — | Language operations on sets; proofs as flow. |
| 2. Finite Automata and Regular Language | 10 | Y | Y | — | — | — | dfa, nfa | Draw a machine and run strings. |
| 3. Context Free Grammar and Pushdown Automata | 10 | Y | Y | — | — | — | cfg, pda | Derivations, parse trees, stack machines. |
| 4. Turing Machine | 10 | Y | Y | — | — | — | tm | Tape, head and control, stepped. |
| 5. Decidability and Computational Complexity | 5 | Y | — | Y flow | diagram | — | — | Halting argument as a flow; class inclusions. |
| 6. Automata Theory and Compiler | 3 | Y | Y | Y flow | — | — | — | Lexer = DFA, parser = CFG. |

## Semester 3 · ENEX 201 — Microprocessors

**Notes:** 5 lessons in `content/courses/enex-201/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction | 4 | Y | — | Y block | — | diagram2 | — | Von Neumann block diagram with animated data flow. |
| 2. Intel 8085 Microprocessor | 12 | Y | Y | — | — | — | cpu8085 | Assembler + single-step 8085 with flags and T-states. |
| 3. Intel 8086 Microprocessor | 14 | Y | Y | Y block | — | diagram2 | — | BIU/EU block diagram; segmentation arithmetic; 8085 engine reused for programming ideas. |
| 4. Microprocessor System | 7 | Y | — | Y block | circuit, truthtable | — | — | Address decoding with live gates; interface diagrams. |
| 5. Interrupt Operations | 5 | Y | — | Y seq | — | diagram2 | — | Interrupt service as an animated sequence diagram. |
| 6. Advanced Topics | 3 | Y | — | Y block | diagram | — | — | Architectures compared as blocks. |

## Semester 4 · ENSH 252 — Numerical Methods

**Notes:** 6 lessons in `content/courses/ensh-252/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Solution of Non-Linear Equations | 7 | Y | Y | — | — | — | rootfind | Bisection/false position/Newton/secant. |
| 2. Solution of System of Linear Algebraic Equations | 8 | Y | Y | — | — | — | gauss, iterative | Elimination with pivoting; Jacobi/Seidel. |
| 3. Interpolation | 9 | Y | Y | — | — | — | interp | Lagrange/Newton polynomial. |
| 4. Numerical Differentiation and Integration | 6 | Y | Y | — | — | — | integrate | Trapezoid/Simpson error. |
| 5. Solution of Ordinary Differential Equations (ODE) | 8 | Y | Y | — | — | — | ode | Euler/Heun/RK4 vs exact. |
| 6. Solution of Partial Differential Equations | 7 | Y | Y | — | — | — | heat1d | Explicit finite differences and stability. |

## Semester 4 · ENEX 252 — Instrumentation

**Notes:** not written yet (matrix only)


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction | 2 | Y | — | Y block | — | diagram2 | — | Measurement system block diagram. |
| 2. Theory of Measurement | 6 | Y | Y | — | table | — | — | Error and calibration with regression. |
| 3. Transducer | 8 | Y | Y | — | circuit | — | — | Sensor models as blocks. |
| 4. Interfacing of Instrumentation System | 14 | Y | Y | — | circuit | — | — | Op-amp conditioning, ADC sampling/quantisation. |
| 5. Connectivity Technology in Instrumentation System | 6 | Y | — | Y seq | — | diagram2 | — | Bus protocols as sequence diagrams. |
| 6. Circuit Design | 4 | Y | Y | — | circuit | — | — | Live circuits. |
| 7. Software for Instrumentation Application | 6 | Y | — | Y flow | diagram | — | — | Acquisition pipeline. |
| 8. Electrical Equipment | 6 | Y | Y | — | circuit | — | — | Existing machines. |
| 9. Latest Trends | 3 | Y | — | Y block | diagram | — | — | IoT chain. |
| 10. Application of Modern Instrumentation System | 5 | Y | — | Y block | diagram | — | — | System diagrams. |

## Semester 4 · ENEX 254 — Electromagnetics

**Notes:** not written yet (matrix only)


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction | 4 | Y | — | — | surface3d | — | — | Vector fields plotted. |
| 2. Electric Field | 15 | Y | Y | — | charge, efield, dielectric | — | — | Existing electrostatics. |
| 3. Magnetic Field | 9 | Y | Y | — | bfield | — | — | Existing. |
| 4. Time Varying Fields | 4 | Y | Y | — | bfield | — | — | Faraday demo (existing). |
| 5. Plane Waves | 9 | Y | Y | — | wave-source, wave-boundary | — | — | Existing wave engine. |
| 6. Transmission Lines | 4 | Y | Y | — | transmission-line | — | — | Existing. |

## Semester 4 · ENCT 252 — Data Structure and Algorithms

**Notes:** 7 lessons in `content/courses/enct-252/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction | 4 | Y | Y | — | dsa | — | — | Complexity measured in the DSA Lab; growth-rate curves. |
| 2. Stack and Recursion | 7 | Y | Y | — | dsa | — | infix, hanoi | Postfix conversion, Hanoi, call stack. |
| 3. Queues | 5 | Y | — | — | dsa | — | — | Queue variants in the C++ lab. |
| 4. Linked List | 6 | Y | — | — | dsa | — | — | Pointer arrows in the lab. |
| 5. Tree | 7 | Y | Y | — | dsa | — | bst, huffman, heap, btree | BST/AVL rotations, Huffman, heaps, B-trees. |
| 6. Graphs | 6 | Y | Y | — | dsa | — | graphalgo | BFS/DFS/MST/topological order. |
| 7. Sorting Algorithms | 5 | Y | Y | — | — | — | sorting | Eight sorts with counters. |
| 8. Searching Algorithms | 5 | Y | Y | — | dsa | — | hashing | Binary search in lab; hashing collisions. |

## Semester 4 · ENCT 253 — Data Communication

**Notes:** 6 lessons in `content/courses/enct-253/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction | 4 | Y | — | Y block | — | diagram2 | — | OSI/communication model with a packet travelling through it. |
| 2. Data Communication Fundamentals | 6 | Y | Y | — | — | — | fourier, pcm | Fourier, Nyquist, Shannon, sampling. |
| 3. Transmission Media and Data Compression | 8 | Y | Y | — | — | — | crc, hamming | Error detection/correction and compression. |
| 4. Signal Encoding Technique | 15 | Y | Y | — | — | — | linecode, modulation | Line codes, ASK/FSK/PSK, AM/FM. |
| 5. Multiplexing and Switching | 8 | Y | — | Y flow | — | diagram2 | — | FDM/TDM/switching as animated flows. |
| 6. Cellular Wireless Communications and Latest Trends | 4 | Y | — | Y block | diagram | — | — | Cell cluster and GSM architecture diagrams. |

## Semester 4 · ENCT 254 — Operating System

**Notes:** 6 lessons in `content/courses/enct-254/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction | 6 | Y | — | Y block | — | diagram2 | — | Kernel types and boot as animated flows. |
| 2. Process Management | 7 | Y | Y | — | — | — | sched | Process states diagram + Gantt scheduler. |
| 3. Process Communication and Synchronization | 10 | Y | Y | Y seq | — | diagram2 | banker | Race/critical section as sequence diagram; banker’s algorithm. |
| 4. I/O and Memory Management | 9 | Y | Y | — | — | — | paging, disk, memfit | Page replacement, disk scheduling, allocation. |
| 5. File Systems | 3 | Y | — | Y block | diagram | — | — | Inode/allocation diagrams. |
| 6. Security and System Administration | 3 | Y | — | Y seq | — | diagram2 | — | Authentication flow. |
| 7. Hypervisors and Virtual Systems | 4 | Y | — | Y block | diagram | — | — | Type 1/2 stacks. |
| 8. Overview of Contemporary OS | 3 | Y | — | Y block | diagram | — | — | Comparison diagram. |

## Semester 5 · ENSH 304 — Probability and Statistics

**Notes:** 5 lessons in `content/courses/ensh-304/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Descriptive Statistics and Basic Probability | 6 | Y | Y | — | chart, table | — | — | Charts + Bayes counting. |
| 2. Probability Distributions and Sampling Distribution | 14 | Y | Y | — | — | — | dist, clt | Binomial/Poisson/normal; CLT. |
| 3. Statistical Inference | 14 | Y | Y | — | — | — | confint | Intervals and tests. |
| 4. Correlation and Regression | 6 | Y | Y | — | — | — | — | Least squares. |
| 5. Statistical Quality Control | 5 | Y | — | — | chart | — | — | Control charts (existing chart). |

## Semester 5 · ENCT 301 — Database Management System

**Notes:** 6 lessons in `content/courses/enct-301/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction | 3 | Y | — | Y block | diagram | — | — | Three-level architecture. |
| 2. Data Models | 7 | Y | — | Y uml | — | diagram2 | — | ER as boxes/arrows; relational mapping. |
| 3. Relational Query Languages | 7 | Y | Y | — | table | — | relalg | Relational algebra row by row; SQL results as tables. |
| 4. Database Constraints and Normalization | 6 | Y | Y | — | — | — | fd | Closure, keys, normal forms. |
| 5. Query Processing and Optimization | 4 | Y | — | Y flow | diagram | — | — | Query plan trees. |
| 6. File Structure and Hashing | 5 | Y | Y | — | — | — | btree | B+ tree and hashing. |
| 7. Transaction Processing and Concurrency Control | 5 | Y | Y | Y seq | — | diagram2 | serializability | Schedules and animated 2PL/2PC. |
| 8. Crash Recovery | 4 | Y | — | Y seq | — | diagram2 | — | Log-based recovery as a sequence. |
| 9. Advanced Database Concepts | 4 | Y | — | Y block | diagram | — | — | Distributed/warehouse architecture. |

## Semester 5 · ENCT 302 — Web Application Programming

**Notes:** 6 lessons in `content/courses/enct-302/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction | 6 | Y | — | Y seq | — | diagram2 | — | HTTP/DNS lifecycle as an animated sequence. |
| 2. JavaScript and Client-Side Programming | 12 | Y | — | Y anim | — | diagram2 | — | Event loop animated; SPA vs MPA. |
| 3. Server-Side Web Programming | 9 | Y | — | Y seq | — | diagram2 | — | MVC request path. |
| 4. Web Services and APIs | 7 | Y | — | Y seq | — | diagram2 | — | REST calls. |
| 5. Web Application Security | 6 | Y | — | Y seq | — | diagram2 | — | XSS/CSRF/JWT flows. |
| 6. Web Application Deployment and Modern Trends | 5 | Y | — | Y flow | diagram | — | — | CI/CD pipeline animated. |

## Semester 5 · ENCT 303 — Computer Organization and Architecture

**Notes:** 7 lessons in `content/courses/enct-303/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction | 5 | Y | Y | Y block | — | diagram2 | — | Instruction cycle animated; performance/Amdahl. |
| 2. Central Processing Unit (CPU) | 7 | Y | Y | — | — | — | — | Addressing modes and stack via the CPU engine. |
| 3. Control Unit | 5 | Y | — | Y block | — | diagram2 | — | Hardwired vs microprogrammed as block diagrams. |
| 4. Memory System | 7 | Y | Y | — | — | — | cache | Mapping, replacement, AMAT. |
| 5. Computer Arithmetic | 8 | Y | Y | — | — | — | booth, ieee754 | Booth, IEEE 754. |
| 6. Pipelining and Vector Processing | 4 | Y | Y | — | — | — | pipeline | Hazards, stalls, forwarding. |
| 7. Input/Output | 5 | Y | — | Y seq | — | diagram2 | — | Programmed/interrupt/DMA as sequences. |
| 8. Multiprocessor System | 4 | Y | — | Y block | diagram | — | — | Interconnection topologies. |

## Semester 5 · ENCT 304 — Computer Networks

**Notes:** 7 lessons in `content/courses/enct-304/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction | 5 | Y | — | Y block | — | diagram2 | — | Layering and encapsulation animated. |
| 2. Physical Layer | 5 | Y | Y | — | linecode | — | — | Encodings; switching types. |
| 3. Data Link Layer | 8 | Y | Y | — | — | — | arq | CRC, ARQ, CSMA reasoning. |
| 4. Network Layer | 12 | Y | Y | — | — | — | subnet, routing | Addressing/VLSM, Dijkstra, distance vector. |
| 5. Transport Layer | 5 | Y | Y | Y seq | — | diagram2 | tcp | Handshake sequence + congestion control. |
| 6. Upper Layers and Network Design | 6 | Y | — | Y seq | — | diagram2 | — | DNS/DHCP/HTTP/SMTP exchanges. |
| 7. Advanced Topics | 4 | Y | — | Y block | diagram | — | — | SDN planes. |

## Semester 5 · ENCT 325-328 — Elective I (Advanced Python for Data Science · Compiler Design · Java Programming · Quantum Computing)

**Notes:** not written yet (matrix only)

> elective chapters are summarised per course; expand when the elective is offered

| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Advanced Python for Data Science — data pipeline | 45 | Y | Y | Y flow | table, chart | — | — | Pipeline flow + regression engine; Python code not executable in-app. |
| 2. Compiler Design — lexing and parsing | 45 | Y | Y | Y flow | — | — | — | Lexer = DFA, parser = CFG, expression stacks. |
| 3. Java Programming — OOP and concurrency | 45 | Y | — | Y uml | dsa | diagram2 | — | UML + threads as sequence. |
| 4. Quantum Computing — states and gates | 45 | Y | Y | — | quantum | — | — | Existing quantum objects for the wave side; gates as block diagrams. |

## Semester 6 · ENCE 356 — Engineering Economics

**Notes:** 4 lessons in `content/courses/ence-356/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction | 2 | Y | — | Y flow | diagram | — | — | Decision process flow. |
| 2. Market Economics | 3 | Y | — | — | graph | — | — | Supply/demand curves (existing graph). |
| 3. Cost | 8 | Y | — | — | graph, table | — | — | Cost curves and break-even. |
| 4. Time Value of Money | 6 | Y | Y | — | cashflow | — | — | Existing cash-flow card. |
| 5. Methods of Economic Analysis | 12 | Y | Y | — | cashflow | — | — | PW/AW/IRR/BC (existing). |
| 6. Replacement Analysis | 5 | Y | Y | — | cashflow | — | — | Existing. |
| 7. Risk Analysis | 5 | Y | Y | — | cashflow | — | — | Monte Carlo on cash flows. |
| 8. Depreciation and Taxes | 5 | Y | — | — | table, chart | — | — | Schedules as tables/charts. |
| 9. Measurement of Nation Income | 5 | Y | — | Y flow | diagram | — | — | Circular flow diagram. |

## Semester 6 · ENCT 351 — Artificial Intelligence

**Notes:** 7 lessons in `content/courses/enct-351/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction | 4 | Y | — | Y block | — | diagram2 | — | Agent–environment loop animated. |
| 2. Problem Solving and Search | 9 | Y | Y | — | — | — | search, minimax | BFS/DFS/A*, alpha-beta, CSP reasoning. |
| 3. Knowledge Representation and Probabilistic Reasoning | 7 | Y | Y | — | — | — | fuzzy | Bayes counting; fuzzy inference. |
| 4. Machine Learning Fundamentals | 10 | Y | Y | — | — | — | kmeans, perceptron | Descent, clustering, linear classifiers. |
| 5. Neural Networks and Deep Learning Algorithms | 8 | Y | Y | — | — | — | mlp | Backprop on XOR. |
| 6. AI Applications | 5 | Y | — | Y block | diagram | — | — | Expert system / NLP pipelines. |
| 7. Emerging Trends | 2 | Y | — | Y flow | diagram | — | — | Federated learning flow. |

## Semester 6 · ENCT 352 — Software Engineering

**Notes:** 5 lessons in `content/courses/enct-352/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction | 4 | Y | — | Y flow | diagram | — | — | Practice as a flow. |
| 2. The Software Process | 8 | Y | — | Y flow | — | diagram2 | — | Waterfall/spiral/Scrum as animated flows. |
| 3. Software Requirements Engineering | 6 | Y | — | Y uml | — | diagram2 | — | Use-case and story flows. |
| 4. Architectural Design | 3 | Y | — | Y block | — | diagram2 | — | Styles as block diagrams. |
| 5. System Modeling | 9 | Y | — | Y uml,seq | — | diagram2 | diagram-v2 | DFD, use case, activity, class, sequence diagrams. |
| 6. Coding and Testing | 5 | Y | — | Y flow | dsa | — | — | Testing pyramid; TDD loop; unit tests in the lab. |
| 7. Software Quality, Assurance, Maintenance | 4 | Y | — | Y flow | diagram | — | — | Maintenance types. |
| 8. Software Configuration Management | 3 | Y | — | Y flow | — | diagram2 | — | Branching flow. |
| 9. Recent Trends | 3 | Y | — | Y flow | — | diagram2 | — | CI/CD pipeline animated. |

## Semester 6 · ENCT 353 — Simulation and Modeling

**Notes:** 8 lessons in `content/courses/enct-353/`


| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Introduction to Simulation | 4 | Y | Y | — | — | — | montecarlo | Monte Carlo; discrete-event idea. |
| 2. Physical and Mathematical Models | 4 | Y | Y | — | mechanics | — | — | Existing physical models + numeric ODEs. |
| 3. Simulation of Continuous System | 5 | Y | Y | — | — | — | blocks | Analog-computer style block simulator. |
| 4. Simulation of Queuing System | 6 | Y | Y | — | — | — | mm1 | M/M/1 vs theory. |
| 5. Markov Chains | 3 | Y | Y | — | — | — | markov | Distribution to steady state. |
| 6. Random Number | 10 | Y | Y | — | — | — | lcg | LCG, period, chi-square, KS. |
| 7. Verification and Validation of Simulation Models | 3 | Y | — | Y flow | diagram | — | — | Naylor–Finger process. |
| 8. Analysis of simulation output | 4 | Y | Y | — | — | — | — | Confidence intervals, replication. |
| 9. Simulation software | 3 | Y | — | Y block | dsa, diagram | — | — | Tool landscape. |
| 10. Simulation of Computer Systems | 3 | Y | Y | — | — | — | — | CPU/memory/network simulation reuse. |

## Semester 6 · ENCT 354 — Minor Project

**Notes:** not written yet (matrix only)

> process course

| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Project Selection, Planning and Documentation | 15 | Y | — | Y flow | diagram | — | — | Project lifecycle flow and checklist. |

## Semester 6 · ENCT 385-399 — Elective II (Network & Systems Programming · IPv6 Networking · Analysis of Algorithms · Audio Processing)

**Notes:** not written yet (matrix only)

> expand when the elective is offered

| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |
|---|--:|:-:|:-:|:-:|---|---|---|---|
| 1. Network and Systems Programming — sockets and processes | 45 | Y | — | Y seq | — | diagram2 | — | Socket call sequences animated. |
| 2. Next-generation Internet (IPv6) | 45 | Y | Y | Y seq | — | — | — | Addressing engine + transition diagrams. |
| 3. Analysis of Algorithms — D&C, greedy, DP, backtracking | 45 | Y | Y | — | dsa | — | — | Reuses the DSA engines. |
| 4. Audio Processing — sampling and spectra | 45 | Y | Y | — | — | — | — | Sampling, quantisation, harmonics. |

## Reserved — syllabus not yet published

| Code | Course | Sem | Planned coverage |
|---|---|--:|---|
| ENEX 416 | Digital Signal Analysis and Processing | 7 | blocks, fourier, pcm engines will carry it |
| ENCT 411 | Distributed and Cloud Computing | 7 | sequence + animated diagrams; sched/cache/mm1 engines |
| ENCT 412 | ICT Project Management | 7 | diagram v2 |
| ENEX 417 | Energy, Environment and Social Engineering | 7 | cashflow + diagrams |
| ENCT 463 | Network and Cyber Security | 8 | sequence diagrams; crc/hamming engines |
| ENCT 413/461/462 | Project I / Project II | 7 | process |

