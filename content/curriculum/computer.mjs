// Bachelor in Computer Engineering (Tribhuvan University, IOE) — the whole
// curriculum as DATA, one row per syllabus chapter, answering the six
// questions asked of every topic:
//
//   Q1 short   can it be explained simply and briefly?
//   Q2 sim     can a simulation teach the concept better than prose?
//   Q3 diag    does a diagram help (flow / sequence / UML / block / animated)?
//   Q4 reuse   which EXISTING component or engine is reused?
//   Q5 enh     what existing component had to be ENHANCED?
//   Q6 neu     which NEW component/engine was created?
//
// Source PDFs: resources/syllabus/. One file per engineering field lives in
// content/curriculum/<program>.mjs, all with this shape, so civil, electrical,
// electronics … are added by dropping in a sibling file and running
// `node scripts/build-curriculum.mjs` (see docs/curriculum/README.md).
//
// Chapter row: [title, hours, tags, how]
//   tags is space-separated key=a,b pairs: sim= diag= reuse= enh= neu= short=0
//   (short defaults to 1; sim/diag/reuse/enh/neu default to none.)

export const program = {
  id: 'computer',
  title: 'Bachelor in Computer Engineering',
  body: 'Tribhuvan University · Institute of Engineering',
  status: 'active',
  source: 'https://ioe.tu.edu.np/pages/computer-engineering-curriculum-structure-2635',
  subjects: [],
}
const S = (code, title, sem, kind, chapters, extra = {}) => program.subjects.push({ code, title, sem, kind, chapters, ...extra })

// ── Year I · Part I ─────────────────────────────────────────────────────────
S('ENSH 101', 'Engineering Mathematics I', 1, 'foundation', [
  ['Derivatives and its Applications', 10, 'sim=gd,rootfind diag=0 reuse=graph,formula,surface3d', 'Slope as a tangent you can drag; Newton and gradient descent make the derivative do work.'],
  ['Antiderivatives and its Applications', 11, 'sim=integrate reuse=graph,formula', 'Area under a curve as rectangles/trapezoids/parabolas that converge.'],
  ['Ordinary Differential Equations and its Applications', 10, 'sim=ode,blocks reuse=graph,mechanics', 'Slope fields as Euler steps; RC and mass-spring as the physical ODEs.'],
  ['Plane Analytic Geometry', 4, 'sim=0 reuse=graph,surface3d', 'Conics plotted from their equations with live parameters.'],
  ['Three Dimensional Geometry', 10, 'sim=project3d reuse=surface3d', 'Planes and spheres in the 3-D plotter; projection engine for views.'],
])
S('ENCT 101', 'Computer Programming', 1, 'core', [
  ['Introduction to Computer Programming', 3, 'diag=flow reuse=dsa,diagram', 'Problem-solving pipeline as a flowchart; compile/link/run as a block diagram.'],
  ['Overview of C Programming', 3, 'sim=0 reuse=dsa', 'Structure of a C program run line by line in the DSA Lab.'],
  ['Operators and Expressions', 3, 'reuse=dsa', 'Precedence and type conversion evaluated step by step.'],
  ['Input and Output', 3, 'reuse=dsa', 'printf/scanf format strings; output panel narrates.'],
  ['Control Structures', 8, 'diag=flow reuse=dsa,diagram', 'if/else and loops: flowchart beside the executing code.'],
  ['Array and Pointer', 7, 'reuse=dsa', 'Memory blocks and pointer arrows make addresses visible.'],
  ['User-defined Functions', 6, 'reuse=dsa', 'Call stack and recursion tree in the DSA Lab.'],
  ['Structures', 5, 'reuse=dsa', 'Struct layout as an object block.'],
  ['File Management', 4, 'diag=flow reuse=diagram', 'File modes and the fopen/fread/fclose lifecycle as a flow diagram.'],
  ['Recent Trends in Programming', 2, 'diag=uml enh=diagram2', 'Procedural vs object-oriented as UML class boxes.'],
])
S('ENME 101', 'Engineering Drawing', 1, 'foundation', [
  ['Dimensioning', 1, 'diag=1 reuse=diagram', 'Drawing conventions as annotated figures.'],
  ['Geometrical Construction', 2, 'sim=raster,bezier reuse=shapes', 'Constructions as ordered steps; Bézier/raster for curves.'],
  ['Basic Descriptive Geometry', 4, 'sim=project3d reuse=surface3d', 'Points/lines/planes in 3-D projection.'],
  ['Multi View (Orthographic) Projections', 8, 'sim=project3d', 'Rotate an object and see the front/top/side projections.'],
  ['Developments and Intersections', 7, 'diag=1 reuse=shapes', 'Unfolding solids drawn as diagrams.'],
  ['Pictorial Drawings', 7, 'sim=project3d', 'Isometric = parallel projection; perspective compared.'],
], { note: 'introduction chapter is untimed in the syllabus' })
S('ENEX 101', 'Fundamental of Electrical and Electronics Engineering', 1, 'foundation', [
  ['Basic Circuits Concepts', 6, 'sim=circuit reuse=circuit,graph', 'Already authored: content/courses/enex-101 (Ohm/Kirchhoff on live circuits).'],
  ['Average and RMS Values', 4, 'sim=circuit reuse=circuit,graph', 'Scope readouts (RMS/avg) on a live AC source.'],
  ['AC Circuit Analysis', 12, 'sim=circuit,blocks reuse=circuit,graph', 'RLC on the MNA solver; phasor ideas via transfer-function block diagrams.'],
  ['Diodes', 7, 'sim=circuit reuse=circuit', 'Rectifier/clipper on the existing diode model.'],
  ['Transistor', 10, 'sim=circuit reuse=circuit', 'BJT/MOSFET switch and amplifier circuits.'],
  ['Operational Amplifier and Oscillator', 6, 'sim=circuit,blocks reuse=circuit', 'Op-amp circuits live; feedback as a block diagram.'],
])
S('ENSH 102', 'Engineering Physics', 1, 'foundation', [
  ['Oscillation', 6, 'sim=mechanics reuse=mechanics,graph', 'Existing rigid-body/spring/damper engine.'],
  ['Acoustics', 3, 'sim=0 reuse=formula', 'Sabine reverberation as a formula card.'],
  ['Heat and Thermodynamics', 8, 'sim=thermal reuse=heatSource,graph', 'Existing thermal solver; heat1d for conduction profiles.'],
  ['Optics', 17, 'sim=optics reuse=optics', 'Existing ray tracer and wave-optics formulas.'],
  ['Electrostatics', 8, 'sim=charges reuse=charge,efield', 'Existing Coulomb and field-region behaviours.'],
  ['Electromagnetism', 6, 'sim=fields reuse=bfield', 'Existing B-field regions and Faraday demo.'],
  ['Electromagnetic Waves', 6, 'sim=waves reuse=waves', 'Existing wave-source/boundary/transmission-line.'],
  ['Photon and Matter Waves', 6, 'sim=quantum reuse=quantum', 'Existing quantum well and tunnel barrier.'],
])
S('ENME 106', 'Engineering Workshop', 1, 'foundation', [
  ['Safety Measures in the Workshop', 1, 'diag=flow reuse=diagram', 'Decision flowcharts for safety.'],
  ['Bench Work and Fittings', 4, 'diag=1 reuse=diagram', 'Process diagrams; no simulation is honest here.'],
  ['Thread Cutting', 1, 'diag=1 reuse=diagram', 'Labelled diagram.'],
  ['Sheet Metal', 2, 'diag=1 reuse=diagram', 'Development diagrams.'],
  ['Machine Tools', 2, 'diag=1 reuse=diagram', 'Block diagram of a lathe’s parts.'],
  ['Forging and Casting', 1.5, 'diag=flow reuse=diagram', 'Process flow.'],
  ['Welding', 2.5, 'diag=1 reuse=diagram', 'Process comparison table.'],
  ['Brazing and Soldering', 1, 'diag=1 reuse=diagram', 'Process comparison table.'],
], { note: 'practical trade skills: diagrams and tables only — a simulation would teach a false picture' })

// ── Year I · Part II ────────────────────────────────────────────────────────
S('ENSH 151', 'Engineering Mathematics II', 2, 'foundation', [
  ['Calculus of Two and More Variables', 6, 'sim=gd reuse=surface3d', 'Partial derivatives on a 3-D surface; 2-variable descent.'],
  ['Multiple Integrals', 7, 'sim=montecarlo,integrate reuse=surface3d', 'Volumes as Monte-Carlo and Riemann sums.'],
  ['Vector Calculus', 12, 'sim=fields reuse=efield,bfield,surface3d', 'Existing field regions for divergence/curl intuition.'],
  ['Laplace Transform', 7, 'sim=blocks reuse=formula', 'Transfer functions as running block diagrams.'],
  ['Matrices', 8, 'sim=gauss,iterative reuse=table', 'Elimination and iteration step by step.'],
  ['Solution of Differential Equation in Series and Special Functions', 5, 'sim=ode reuse=graph', 'Compare series and numeric solutions.'],
])
S('ENCT 151', 'Object Oriented Programming', 2, 'core', [
  ['Introduction to Object Oriented Programming', 3, 'diag=uml enh=diagram2', 'Objects, classes, messages as UML class boxes.'],
  ['Basics of C++ Programming', 5, 'diag=seq reuse=dsa', 'References and new/delete run in the DSA Lab; overload resolution shown as a sequence (the Lab interpreter does not resolve overloads or default arguments yet).'],
  ['Objects and Classes', 7, 'diag=uml,seq reuse=dsa enh=diagram2', 'Encapsulation and constructors run in the lab; destructor order drawn as a sequence (no destructors in the Lab interpreter).'],
  ['Operator Overloading', 5, 'diag=seq enh=diagram2', 'a + b as a method-call sequence (the Lab interpreter has no operator overloading).'],
  ['Inheritance', 5, 'diag=uml,seq enh=diagram2', 'UML inheritance diagram + constructor order as a sequence (Lab interpreter lacks inheritance).'],
  ['Virtual Functions', 4, 'diag=uml,seq enh=diagram2', 'vtable dispatch as an animated sequence (Lab interpreter lacks virtual functions).'],
  ['Stream Computation', 6, 'diag=flow reuse=dsa,diagram', 'Stream class hierarchy diagram.'],
  ['Templates', 6, 'diag=seq', 'Instantiation shown as a compiler sequence (Lab interpreter lacks templates).'],
  ['Exception Handling', 4, 'diag=flow reuse=dsa,diagram', 'throw/catch unwinding as flow.'],
])
S('ENEX 152', 'Digital Logic', 2, 'core', [
  ['Introduction', 5, 'sim=numconv reuse=circuit', 'Codes and complements converted step by step.'],
  ['Logic Gates', 3, 'sim=circuit reuse=circuit,truthtable', 'Live gates and truth tables (existing).'],
  ['Boolean Algebra and K-Maps', 4, 'sim=kmap reuse=truthtable', 'K-map minimiser with groups.'],
  ['Combinational Logic Circuits', 8, 'sim=circuit reuse=circuit,truthtable', 'Adders/mux/decoders as real circuits (adders lesson exists).'],
  ['Sequential Logic Circuits', 5, 'sim=circuit reuse=circuit', 'Flip-flops on the live logic solver.'],
  ['Registers and Counters', 7, 'sim=circuit reuse=circuit,graph', 'Registers/counters with timing graphs.'],
  ['Sequential Machine Designs', 8, 'sim=dfa reuse=circuit', 'State diagrams simulated by the automaton engine.'],
  ['Digital Integrated Circuits', 5, 'sim=circuit reuse=circuit', 'CMOS/TTL switching circuits.'],
])
S('ENEX 151', 'Electronic Device and Circuits', 2, 'foundation', [
  ['The Bipolar Junction Transistor (BJT)', 9, 'sim=circuit reuse=circuit', 'Existing BJT.'],
  ['Field-Effect Transistor', 10, 'sim=circuit reuse=circuit', 'Existing MOSFET.'],
  ['Operational Amplifier Circuits and Oscillator', 10, 'sim=circuit,blocks reuse=circuit', 'Op-amp + feedback block diagram.'],
  ['Output Stages and Power Amplifiers', 10, 'sim=circuit reuse=circuit', 'Push-pull stages.'],
  ['Power Supplies, Breakdown Diodes, and Voltage Reference', 6, 'sim=circuit reuse=circuit', 'Rectifier + zener regulator.'],
])
S('ENSH 153', 'Engineering Chemistry', 2, 'foundation', [
  ['Electrochemistry and Buffer', 8, 'sim=0 diag=1 reuse=formula,chart', 'Nernst/pH as formula + chart; honest diagrams.'],
  ['Catalyst and Catalysis', 4, 'diag=1 reuse=diagram', 'Energy-profile diagram.'],
  ['Analytical Techniques and their Applications', 6, 'diag=1 reuse=chart,diagram', 'Instrument block diagrams.'],
  ['Metal Complexes, Rare Earth Elements and Metal alloys', 6, 'diag=1 reuse=table', 'Tables/diagrams.'],
  ['Sustainable Chemistry', 7, 'diag=flow reuse=diagram', 'Process flows.'],
  ['Nanoscience and Nanotechnology', 3, 'sim=quantum reuse=quantum', 'Quantum confinement (existing well).'],
  ['Engineering Materials', 7, 'diag=1 reuse=table', 'Property tables.'],
  ['Explosives, Lubricants and Paints', 4, 'diag=1 reuse=table', 'Tables.'],
], { note: 'chemistry is descriptive; the app has no chemistry engine, so only the quantitative parts are simulated' })
S('ENEE 154', 'Electrical Circuits and Machines', 2, 'foundation', [
  ['Transients in Electric Circuit', 7, 'sim=circuit reuse=circuit,graph', 'RC/RL on the MNA transient solver.'],
  ['Transient Analysis R-L-C Circuit by Classical Method', 10, 'sim=circuit,ode reuse=circuit,graph', 'Damping cases live.'],
  ['Transient Analysis Using Laplace Transform', 7, 'sim=blocks', 'Step response of transfer functions in the block simulator.'],
  ['Network Transfer Function and Frequency Response', 8, 'sim=blocks reuse=graph', 'Block diagrams with gain/tf and scopes.'],
  ['Two-Port Parameters of Network', 8, 'diag=block reuse=circuit', 'Two-port as a block diagram + circuit.'],
  ['Magnetic Circuit and Induction', 3, 'sim=fields reuse=bfield', 'Existing fields.'],
  ['Transformers', 6, 'sim=circuit reuse=circuit', 'Existing transformer.'],
  ['DC Machine', 5, 'sim=circuit reuse=dc-machine', 'Existing dc-machine.'],
  ['AC Motor', 6, 'sim=circuit reuse=induction-motor', 'Existing induction motor.'],
])

// ── Year II · Part I ────────────────────────────────────────────────────────
S('ENSH 201', 'Engineering Mathematics III', 3, 'foundation', [
  ['Fourier Series and Fourier Transform', 12, 'sim=fourier reuse=graph', 'Harmonics summed live; Gibbs overshoot.'],
  ['Functions of Complex Variable', 12, 'sim=0 reuse=surface3d,formula', 'Mappings on the 3-D plotter.'],
  ['Partial Differential Equations', 5, 'sim=heat1d reuse=graph', 'Heat equation by finite differences.'],
  ['Modelling through Partial Differential Equation', 10, 'sim=heat1d,waves reuse=waves', 'Wave and heat models.'],
  ['Z- transform and its Applications', 6, 'sim=blocks', 'Discrete blocks (delay, gain, sum) in the simulator.'],
])
S('ENSH 204', 'Communication English', 3, 'foundation', [
  ['Technical Communication', 2, 'diag=flow reuse=diagram', 'Communication model as a block diagram.'],
  ['Writing Skills', 8, 'diag=1 reuse=diagram', 'Structure diagrams.'],
  ['Technical Writing', 15, 'diag=flow reuse=diagram', 'Report structure flows.'],
  ['Business Correspondence', 10, 'diag=1 reuse=diagram', 'Templates.'],
  ['Listening and Oral Communication', 4, 'diag=1 reuse=diagram', 'Process diagrams.'],
  ['Use of Visual Aids in Communication', 6, 'sim=0 diag=1 reuse=chart', 'Chart types compared (existing chart).'],
], { note: 'language skills: diagrams and worked examples; no simulation' })
S('ENCT 201', 'Computer Graphics and Visualization', 3, 'core', [
  ['Introduction and Application', 4, 'diag=flow enh=diagram2', 'Graphics pipeline as an animated flow.'],
  ['Raster Graphics and Algorithms', 9, 'sim=raster,clip neu=raster,clip', 'DDA/Bresenham/circle/fill and clipping, pixel by pixel.'],
  ['2D and 3D Coordinate Systems and Viewing Transformations', 9, 'sim=transform2d,project3d neu=transform2d,project3d', 'Homogeneous matrices and projections.'],
  ['Curve Modeling and Surface Modelling', 4, 'sim=bezier reuse=surface3d neu=bezier', 'de Casteljau; surfaces in the 3-D plotter.'],
  ['Visible Surface Determination', 4, 'diag=flow reuse=diagram', 'Z-buffer as a flow + worked table.'],
  ['Illumination and Surface Rendering Methods', 4, 'sim=phong neu=phong', 'Ambient/diffuse/specular curves.'],
  ['Computer Animation and Visualization', 5, 'sim=bezier diag=anim enh=diagram2', 'Keyframes as animated diagrams; interpolation curves.'],
  ['Latest Trends in Computer Graphics', 6, 'diag=flow reuse=diagram', 'Pipeline diagrams for AR/VR.'],
])
S('ENCT 202', 'Foundation of Data Science', 3, 'core', [
  ['Introduction to Data Science', 3, 'diag=flow reuse=diagram', 'Lifecycle as a loop diagram.'],
  ['Mathematics for Data Science', 10, 'sim=gd,dist,clt,confint neu=gd,dist,clt,confint reuse=table', 'Gradient descent, distributions, CLT, intervals.'],
  ['Data Understanding and Preprocessing', 10, 'diag=flow reuse=table,chart', 'Cleaning pipeline; before/after tables.'],
  ['Data Analysis', 8, 'sim=0 reuse=chart,table', 'Charts and summaries (existing chart/table).'],
  ['Regression and Predictive Modeling', 5, 'sim=regression neu=regression', 'Least squares with residuals.'],
  ['Modeling and Validation Processes', 6, 'sim=kmeans,perceptron', 'Learning loops; validation as a diagram.'],
  ['Ethics and Recent Trends', 3, 'diag=flow reuse=diagram', 'Responsible-data flow.'],
])
S('ENCT 203', 'Theory of Computation', 3, 'core', [
  ['Introduction to Formal Language, Logic and Proof', 7, 'diag=flow reuse=diagram', 'Language operations on sets; proofs as flow.'],
  ['Finite Automata and Regular Language', 10, 'sim=dfa,nfa neu=dfa,nfa', 'Draw a machine and run strings.'],
  ['Context Free Grammar and Pushdown Automata', 10, 'sim=cfg,pda neu=cfg,pda', 'Derivations, parse trees, stack machines.'],
  ['Turing Machine', 10, 'sim=tm neu=tm', 'Tape, head and control, stepped.'],
  ['Decidability and Computational Complexity', 5, 'diag=flow reuse=diagram', 'Halting argument as a flow; class inclusions.'],
  ['Automata Theory and Compiler', 3, 'sim=dfa,cfg diag=flow', 'Lexer = DFA, parser = CFG.'],
])
S('ENEX 201', 'Microprocessors', 3, 'core', [
  ['Introduction', 4, 'diag=block enh=diagram2', 'Von Neumann block diagram with animated data flow.'],
  ['Intel 8085 Microprocessor', 12, 'sim=cpu8085 neu=cpu8085', 'Assembler + single-step 8085 with flags and T-states.'],
  ['Intel 8086 Microprocessor', 14, 'diag=block sim=cpu8085 enh=diagram2', 'BIU/EU block diagram; segmentation arithmetic; 8085 engine reused for programming ideas.'],
  ['Microprocessor System', 7, 'diag=block reuse=circuit,truthtable', 'Address decoding with live gates; interface diagrams.'],
  ['Interrupt Operations', 5, 'diag=seq enh=diagram2', 'Interrupt service as an animated sequence diagram.'],
  ['Advanced Topics', 3, 'diag=block reuse=diagram', 'Architectures compared as blocks.'],
])

// ── Year II · Part II ───────────────────────────────────────────────────────
S('ENSH 252', 'Numerical Methods', 4, 'foundation', [
  ['Solution of Non-Linear Equations', 7, 'sim=rootfind neu=rootfind', 'Bisection/false position/Newton/secant.'],
  ['Solution of System of Linear Algebraic Equations', 8, 'sim=gauss,iterative neu=gauss,iterative', 'Elimination with pivoting; Jacobi/Seidel.'],
  ['Interpolation', 9, 'sim=interp neu=interp', 'Lagrange/Newton polynomial.'],
  ['Numerical Differentiation and Integration', 6, 'sim=integrate neu=integrate', 'Trapezoid/Simpson error.'],
  ['Solution of Ordinary Differential Equations (ODE)', 8, 'sim=ode neu=ode', 'Euler/Heun/RK4 vs exact.'],
  ['Solution of Partial Differential Equations', 7, 'sim=heat1d neu=heat1d', 'Explicit finite differences and stability.'],
])
S('ENEX 252', 'Instrumentation', 4, 'foundation', [
  ['Introduction', 2, 'diag=block enh=diagram2', 'Measurement system block diagram.'],
  ['Theory of Measurement', 6, 'sim=regression,confint reuse=table', 'Error and calibration with regression.'],
  ['Transducer', 8, 'sim=blocks reuse=circuit', 'Sensor models as blocks.'],
  ['Interfacing of Instrumentation System', 14, 'sim=circuit,pcm reuse=circuit', 'Op-amp conditioning, ADC sampling/quantisation.'],
  ['Connectivity Technology in Instrumentation System', 6, 'diag=seq enh=diagram2', 'Bus protocols as sequence diagrams.'],
  ['Circuit Design', 4, 'sim=circuit reuse=circuit', 'Live circuits.'],
  ['Software for Instrumentation Application', 6, 'diag=flow reuse=diagram', 'Acquisition pipeline.'],
  ['Electrical Equipment', 6, 'sim=circuit reuse=circuit', 'Existing machines.'],
  ['Latest Trends', 3, 'diag=block reuse=diagram', 'IoT chain.'],
  ['Application of Modern Instrumentation System', 5, 'diag=block reuse=diagram', 'System diagrams.'],
])
S('ENEX 254', 'Electromagnetics', 4, 'foundation', [
  ['Introduction', 4, 'sim=0 reuse=surface3d', 'Vector fields plotted.'],
  ['Electric Field', 15, 'sim=fields reuse=charge,efield,dielectric', 'Existing electrostatics.'],
  ['Magnetic Field', 9, 'sim=fields reuse=bfield', 'Existing.'],
  ['Time Varying Fields', 4, 'sim=fields reuse=bfield', 'Faraday demo (existing).'],
  ['Plane Waves', 9, 'sim=waves reuse=wave-source,wave-boundary', 'Existing wave engine.'],
  ['Transmission Lines', 4, 'sim=waves reuse=transmission-line', 'Existing.'],
])
S('ENCT 252', 'Data Structure and Algorithms', 4, 'core', [
  ['Introduction', 4, 'sim=sorting reuse=dsa', 'Complexity measured in the DSA Lab; growth-rate curves.'],
  ['Stack and Recursion', 7, 'sim=infix,hanoi reuse=dsa neu=infix,hanoi', 'Postfix conversion, Hanoi, call stack.'],
  ['Queues', 5, 'reuse=dsa', 'Queue variants in the C++ lab.'],
  ['Linked List', 6, 'reuse=dsa', 'Pointer arrows in the lab.'],
  ['Tree', 7, 'sim=bst,huffman,heap,btree neu=bst,huffman,heap,btree reuse=dsa', 'BST/AVL rotations, Huffman, heaps, B-trees.'],
  ['Graphs', 6, 'sim=graphalgo,routing neu=graphalgo reuse=dsa', 'BFS/DFS/MST/topological order.'],
  ['Sorting Algorithms', 5, 'sim=sorting neu=sorting', 'Eight sorts with counters.'],
  ['Searching Algorithms', 5, 'sim=hashing neu=hashing reuse=dsa', 'Binary search in lab; hashing collisions.'],
])
S('ENCT 253', 'Data Communication', 4, 'core', [
  ['Introduction', 4, 'diag=block enh=diagram2', 'OSI/communication model with a packet travelling through it.'],
  ['Data Communication Fundamentals', 6, 'sim=fourier,pcm neu=fourier,pcm', 'Fourier, Nyquist, Shannon, sampling.'],
  ['Transmission Media and Data Compression', 8, 'sim=crc,hamming,huffman neu=crc,hamming', 'Error detection/correction and compression.'],
  ['Signal Encoding Technique', 15, 'sim=linecode,modulation,pcm neu=linecode,modulation', 'Line codes, ASK/FSK/PSK, AM/FM.'],
  ['Multiplexing and Switching', 8, 'diag=flow enh=diagram2', 'FDM/TDM/switching as animated flows.'],
  ['Cellular Wireless Communications and Latest Trends', 4, 'diag=block reuse=diagram', 'Cell cluster and GSM architecture diagrams.'],
])
S('ENCT 254', 'Operating System', 4, 'core', [
  ['Introduction', 6, 'diag=block enh=diagram2', 'Kernel types and boot as animated flows.'],
  ['Process Management', 7, 'sim=sched neu=sched', 'Process states diagram + Gantt scheduler.'],
  ['Process Communication and Synchronization', 10, 'sim=banker diag=seq neu=banker enh=diagram2', 'Race/critical section as sequence diagram; banker’s algorithm.'],
  ['I/O and Memory Management', 9, 'sim=paging,disk,memfit neu=paging,disk,memfit', 'Page replacement, disk scheduling, allocation.'],
  ['File Systems', 3, 'diag=block reuse=diagram', 'Inode/allocation diagrams.'],
  ['Security and System Administration', 3, 'diag=seq enh=diagram2', 'Authentication flow.'],
  ['Hypervisors and Virtual Systems', 4, 'diag=block reuse=diagram', 'Type 1/2 stacks.'],
  ['Overview of Contemporary OS', 3, 'diag=block reuse=diagram', 'Comparison diagram.'],
])

// ── Year III · Part I ───────────────────────────────────────────────────────
S('ENSH 304', 'Probability and Statistics', 5, 'foundation', [
  ['Descriptive Statistics and Basic Probability', 6, 'sim=bayes,montecarlo reuse=chart,table', 'Charts + Bayes counting.'],
  ['Probability Distributions and Sampling Distribution', 14, 'sim=dist,clt neu=dist,clt', 'Binomial/Poisson/normal; CLT.'],
  ['Statistical Inference', 14, 'sim=confint neu=confint', 'Intervals and tests.'],
  ['Correlation and Regression', 6, 'sim=regression', 'Least squares.'],
  ['Statistical Quality Control', 5, 'sim=0 reuse=chart', 'Control charts (existing chart).'],
])
S('ENCT 301', 'Database Management System', 5, 'core', [
  ['Introduction', 3, 'diag=block reuse=diagram', 'Three-level architecture.'],
  ['Data Models', 7, 'diag=uml enh=diagram2', 'ER as boxes/arrows; relational mapping.'],
  ['Relational Query Languages', 7, 'sim=relalg neu=relalg reuse=table', 'Relational algebra row by row; SQL results as tables.'],
  ['Database Constraints and Normalization', 6, 'sim=fd neu=fd', 'Closure, keys, normal forms.'],
  ['Query Processing and Optimization', 4, 'diag=flow reuse=diagram', 'Query plan trees.'],
  ['File Structure and Hashing', 5, 'sim=btree,hashing neu=btree', 'B+ tree and hashing.'],
  ['Transaction Processing and Concurrency Control', 5, 'sim=serializability diag=seq neu=serializability enh=diagram2', 'Schedules and animated 2PL/2PC.'],
  ['Crash Recovery', 4, 'diag=seq enh=diagram2', 'Log-based recovery as a sequence.'],
  ['Advanced Database Concepts', 4, 'diag=block reuse=diagram', 'Distributed/warehouse architecture.'],
])
S('ENCT 302', 'Web Application Programming', 5, 'core', [
  ['Introduction', 6, 'diag=seq enh=diagram2', 'HTTP/DNS lifecycle as an animated sequence.'],
  ['JavaScript and Client-Side Programming', 12, 'diag=anim enh=diagram2', 'Event loop animated; SPA vs MPA.'],
  ['Server-Side Web Programming', 9, 'diag=seq enh=diagram2', 'MVC request path.'],
  ['Web Services and APIs', 7, 'diag=seq enh=diagram2', 'REST calls.'],
  ['Web Application Security', 6, 'diag=seq enh=diagram2', 'XSS/CSRF/JWT flows.'],
  ['Web Application Deployment and Modern Trends', 5, 'diag=flow reuse=diagram', 'CI/CD pipeline animated.'],
])
S('ENCT 303', 'Computer Organization and Architecture', 5, 'core', [
  ['Introduction', 5, 'diag=block sim=cpu8085 enh=diagram2', 'Instruction cycle animated; performance/Amdahl.'],
  ['Central Processing Unit (CPU)', 7, 'sim=cpu8085', 'Addressing modes and stack via the CPU engine.'],
  ['Control Unit', 5, 'diag=block enh=diagram2', 'Hardwired vs microprogrammed as block diagrams.'],
  ['Memory System', 7, 'sim=cache neu=cache', 'Mapping, replacement, AMAT.'],
  ['Computer Arithmetic', 8, 'sim=booth,ieee754,numconv neu=booth,ieee754', 'Booth, IEEE 754.'],
  ['Pipelining and Vector Processing', 4, 'sim=pipeline neu=pipeline', 'Hazards, stalls, forwarding.'],
  ['Input/Output', 5, 'diag=seq enh=diagram2', 'Programmed/interrupt/DMA as sequences.'],
  ['Multiprocessor System', 4, 'diag=block reuse=diagram', 'Interconnection topologies.'],
])
S('ENCT 304', 'Computer Networks', 5, 'core', [
  ['Introduction', 5, 'diag=block enh=diagram2', 'Layering and encapsulation animated.'],
  ['Physical Layer', 5, 'sim=linecode reuse=linecode', 'Encodings; switching types.'],
  ['Data Link Layer', 8, 'sim=crc,arq neu=arq', 'CRC, ARQ, CSMA reasoning.'],
  ['Network Layer', 12, 'sim=subnet,routing neu=subnet,routing', 'Addressing/VLSM, Dijkstra, distance vector.'],
  ['Transport Layer', 5, 'sim=tcp diag=seq neu=tcp enh=diagram2', 'Handshake sequence + congestion control.'],
  ['Upper Layers and Network Design', 6, 'diag=seq enh=diagram2', 'DNS/DHCP/HTTP/SMTP exchanges.'],
  ['Advanced Topics', 4, 'diag=block reuse=diagram', 'SDN planes.'],
])
S('ENCT 325-328', 'Elective I (Advanced Python for Data Science · Compiler Design · Java Programming · Quantum Computing)', 5, 'elective', [
  ['Advanced Python for Data Science — data pipeline', 45, 'diag=flow sim=regression reuse=table,chart', 'Pipeline flow + regression engine; Python code not executable in-app.'],
  ['Compiler Design — lexing and parsing', 45, 'sim=dfa,cfg,infix diag=flow', 'Lexer = DFA, parser = CFG, expression stacks.'],
  ['Java Programming — OOP and concurrency', 45, 'diag=uml reuse=dsa enh=diagram2', 'UML + threads as sequence.'],
  ['Quantum Computing — states and gates', 45, 'sim=quantum reuse=quantum', 'Existing quantum objects for the wave side; gates as block diagrams.'],
], { note: 'elective chapters are summarised per course; expand when the elective is offered' })

// ── Year III · Part II ──────────────────────────────────────────────────────
S('ENCE 356', 'Engineering Economics', 6, 'foundation', [
  ['Introduction', 2, 'diag=flow reuse=diagram', 'Decision process flow.'],
  ['Market Economics', 3, 'sim=0 reuse=graph', 'Supply/demand curves (existing graph).'],
  ['Cost', 8, 'sim=0 reuse=graph,table', 'Cost curves and break-even.'],
  ['Time Value of Money', 6, 'sim=cashflow reuse=cashflow', 'Existing cash-flow card.'],
  ['Methods of Economic Analysis', 12, 'sim=cashflow reuse=cashflow', 'PW/AW/IRR/BC (existing).'],
  ['Replacement Analysis', 5, 'sim=cashflow reuse=cashflow', 'Existing.'],
  ['Risk Analysis', 5, 'sim=montecarlo,dist reuse=cashflow', 'Monte Carlo on cash flows.'],
  ['Depreciation and Taxes', 5, 'sim=0 reuse=table,chart', 'Schedules as tables/charts.'],
  ['Measurement of Nation Income', 5, 'diag=flow reuse=diagram', 'Circular flow diagram.'],
])
S('ENCT 351', 'Artificial Intelligence', 6, 'core', [
  ['Introduction', 4, 'diag=block enh=diagram2', 'Agent–environment loop animated.'],
  ['Problem Solving and Search', 9, 'sim=search,minimax neu=search,minimax', 'BFS/DFS/A*, alpha-beta, CSP reasoning.'],
  ['Knowledge Representation and Probabilistic Reasoning', 7, 'sim=bayes,fuzzy neu=fuzzy', 'Bayes counting; fuzzy inference.'],
  ['Machine Learning Fundamentals', 10, 'sim=gd,kmeans,perceptron,regression neu=kmeans,perceptron', 'Descent, clustering, linear classifiers.'],
  ['Neural Networks and Deep Learning Algorithms', 8, 'sim=mlp neu=mlp', 'Backprop on XOR.'],
  ['AI Applications', 5, 'diag=block reuse=diagram', 'Expert system / NLP pipelines.'],
  ['Emerging Trends', 2, 'diag=flow reuse=diagram', 'Federated learning flow.'],
])
S('ENCT 352', 'Software Engineering', 6, 'core', [
  ['Introduction', 4, 'diag=flow reuse=diagram', 'Practice as a flow.'],
  ['The Software Process', 8, 'diag=flow enh=diagram2', 'Waterfall/spiral/Scrum as animated flows.'],
  ['Software Requirements Engineering', 6, 'diag=uml enh=diagram2', 'Use-case and story flows.'],
  ['Architectural Design', 3, 'diag=block enh=diagram2', 'Styles as block diagrams.'],
  ['System Modeling', 9, 'diag=uml,seq neu=diagram-v2 enh=diagram2', 'DFD, use case, activity, class, sequence diagrams.'],
  ['Coding and Testing', 5, 'diag=flow reuse=dsa', 'Testing pyramid; TDD loop; unit tests in the lab.'],
  ['Software Quality, Assurance, Maintenance', 4, 'diag=flow reuse=diagram', 'Maintenance types.'],
  ['Software Configuration Management', 3, 'diag=flow enh=diagram2', 'Branching flow.'],
  ['Recent Trends', 3, 'diag=flow enh=diagram2', 'CI/CD pipeline animated.'],
])
S('ENCT 353', 'Simulation and Modeling', 6, 'core', [
  ['Introduction to Simulation', 4, 'sim=montecarlo neu=montecarlo', 'Monte Carlo; discrete-event idea.'],
  ['Physical and Mathematical Models', 4, 'sim=ode,heat1d reuse=mechanics', 'Existing physical models + numeric ODEs.'],
  ['Simulation of Continuous System', 5, 'sim=blocks neu=blocks', 'Analog-computer style block simulator.'],
  ['Simulation of Queuing System', 6, 'sim=mm1 neu=mm1', 'M/M/1 vs theory.'],
  ['Markov Chains', 3, 'sim=markov neu=markov', 'Distribution to steady state.'],
  ['Random Number', 10, 'sim=lcg neu=lcg', 'LCG, period, chi-square, KS.'],
  ['Verification and Validation of Simulation Models', 3, 'diag=flow reuse=diagram', 'Naylor–Finger process.'],
  ['Analysis of simulation output', 4, 'sim=confint,clt', 'Confidence intervals, replication.'],
  ['Simulation software', 3, 'diag=block reuse=dsa,diagram', 'Tool landscape.'],
  ['Simulation of Computer Systems', 3, 'sim=cache,sched,mm1', 'CPU/memory/network simulation reuse.'],
])
S('ENCT 354', 'Minor Project', 6, 'core', [
  ['Project Selection, Planning and Documentation', 15, 'diag=flow reuse=diagram', 'Project lifecycle flow and checklist.'],
], { note: 'process course' })
S('ENCT 385-399', 'Elective II (Network & Systems Programming · IPv6 Networking · Analysis of Algorithms · Audio Processing)', 6, 'elective', [
  ['Network and Systems Programming — sockets and processes', 45, 'diag=seq enh=diagram2', 'Socket call sequences animated.'],
  ['Next-generation Internet (IPv6)', 45, 'sim=subnet diag=seq', 'Addressing engine + transition diagrams.'],
  ['Analysis of Algorithms — D&C, greedy, DP, backtracking', 45, 'sim=sorting,huffman,graphalgo,hanoi reuse=dsa', 'Reuses the DSA engines.'],
  ['Audio Processing — sampling and spectra', 45, 'sim=pcm,fourier', 'Sampling, quantisation, harmonics.'],
], { note: 'expand when the elective is offered' })

// ── Year IV — syllabus PDFs not yet published by IOE ───────────────────────
program.reserved = [
  ['ENEX 416', 'Digital Signal Analysis and Processing', 7, 'blocks, fourier, pcm engines will carry it'],
  ['ENCT 411', 'Distributed and Cloud Computing', 7, 'sequence + animated diagrams; sched/cache/mm1 engines'],
  ['ENCT 412', 'ICT Project Management', 7, 'diagram v2'],
  ['ENEX 417', 'Energy, Environment and Social Engineering', 7, 'cashflow + diagrams'],
  ['ENCT 463', 'Network and Cyber Security', 8, 'sequence diagrams; crc/hamming engines'],
  ['ENCT 413/461/462', 'Project I / Project II', 7, 'process'],
]
