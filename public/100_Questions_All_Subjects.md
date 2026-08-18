# 100 Practice Questions — Year I/II Engineering Courses

Covers: Electromagnetics (ENEX 254) · Digital Logic (ENEX 152) · Electrical Circuits and Machines (ENEE 154) · Engineering Physics (ENSH 102) · Fundamentals of Electrical and Electronics Engineering (ENEX 101)

Question types are marked: **[N]** Numerical, **[D]** Derivation, **[S]** Short note / conceptual.

---

## A. Electromagnetics (ENEX 254) — Q1–20

1. **[N]** Convert the point P(3, 4, 5) in Cartesian coordinates to cylindrical and spherical coordinates.
2. **[S]** Differentiate between gradient, divergence, and curl with the physical significance of each.
3. **[D]** State and derive Coulomb's law in vector form for two point charges, and extend it to a system of *n* point charges.
4. **[N]** Three point charges of +2 nC, −3 nC, and +4 nC are located at (0,0,0), (2,0,0), and (0,3,0) m respectively. Find the net electric field at the origin due to the other two charges... (adjust as needed) — find E at point (2, 3, 0).
5. **[D]** State Gauss's law and derive the expression for electric field intensity due to an infinite line charge using Gauss's law.
6. **[D]** Derive the divergence theorem and explain its physical significance in relating electric flux density to volume charge density.
7. **[D]** Derive the expression for electric potential due to a point charge and hence define potential gradient. Show that **E** = −∇V.
8. **[N]** Two infinite parallel plates carrying surface charge densities +σ and −σ are separated by a dielectric of relative permittivity εr = 4. Find the electric field intensity and energy density in the region between the plates.
9. **[S]** Explain free and bound charges, polarization, and derive the boundary conditions for the normal and tangential components of **D** and **E** at a dielectric-dielectric interface.
10. **[D]** Derive the continuity equation from the principle of conservation of charge and define relaxation time.
11. **[D]** Starting from Poisson's equation, derive Laplace's equation and state the uniqueness theorem for boundary value problems.
12. **[D]** State and derive Biot–Savart's law for magnetic field intensity due to a current element.
13. **[N]** A circular loop of radius 5 cm carries a current of 10 A. Calculate the magnetic field intensity at a point on its axis 12 cm from the center.
14. **[D]** State Ampere's circuital law and use it to derive the magnetic field intensity inside and outside a long straight current-carrying conductor.
15. **[D]** Derive Stoke's theorem and explain its significance with respect to curl of a magnetic field.
16. **[S]** Explain magnetic boundary conditions and derive the relation between B1, B2 and the surface current density at the interface of two media.
17. **[D]** Derive Faraday's law of electromagnetic induction and distinguish between transformer EMF and motional EMF with examples.
18. **[D]** Starting from Ampere's law, introduce the concept of displacement current and derive Maxwell's four equations in both point (differential) and integral form.
19. **[D]** Derive the wave equation for a uniform plane wave propagating in a lossless dielectric medium from Maxwell's equations, and obtain the expression for intrinsic impedance.
20. **[N]** A transmission line has a characteristic impedance of 50 Ω and is terminated in a load of 75 + j25 Ω. Calculate the reflection coefficient and the voltage standing wave ratio (VSWR).

---

## B. Digital Logic (ENEX 152) — Q21–40

21. **[N]** Convert (173.625)10 to binary, octal, and hexadecimal.
22. **[N]** Represent −45 in 8-bit 1's complement and 2's complement form, and verify by adding +45 and −45.
23. **[S]** Explain BCD, Excess-3, and Gray codes with a conversion table for decimal digits 0–9.
24. **[D]** State and prove De Morgan's two theorems using truth tables, and show how NAND and NOR are universal gates.
25. **[N]** Simplify F(A,B,C,D) = Σm(0,1,2,5,7,8,9,10,13,15) using a 4-variable K-map and realize it using basic gates.
26. **[N]** Simplify F(A,B,C,D) = Σm(1,3,7,11,15) + d(0,2,5) using K-map with don't-care conditions.
27. **[S]** Differentiate between SOP and POS forms with an example, and define minterm and maxterm.
28. **[D]** Design a full adder using two half-adders and a logic gate. Draw the circuit and write the truth table.
29. **[D]** Design a 4-to-1 multiplexer using logic gates and explain how it can be used to implement any 3-variable Boolean function.
30. **[D]** Design a 2-to-4 line decoder using basic logic gates and explain its use in a BCD-to-decimal decoder.
31. **[N]** Design a 2-bit magnitude comparator and draw its truth table and logic diagram.
32. **[S]** Draw the characteristic table and excitation table of SR, D, T, and JK flip-flops.
33. **[D]** Convert an SR flip-flop into a JK flip-flop. Derive the excitation equations and draw the logic diagram.
34. **[D]** Draw and explain the timing diagram of a master-slave JK flip-flop, highlighting the race-around condition and its solution.
35. **[D]** Design a 4-bit SISO (Serial-In Serial-Out) shift register using D flip-flops and explain its operation.
36. **[D]** Design a mod-6 asynchronous (ripple) counter using JK flip-flops and draw its timing diagram.
37. **[D]** Design a mod-10 synchronous (decade) counter using JK flip-flops with the state table and excitation map.
38. **[D]** Design a synchronous sequence detector that outputs 1 whenever it detects the input sequence "1011" (overlapping allowed). Draw the state diagram and transition table.
39. **[S]** Explain the concept of redundant states in sequential machine design and how they are eliminated using state reduction.
40. **[S]** Compare TTL and CMOS logic families in terms of power dissipation, noise margin, speed, and fan-out.

---

## C. Electrical Circuits and Machines (ENEE 154) — Q41–60

41. **[N]** Using nodal analysis, find the node voltages in a circuit with a 10 A current source, and resistors of 2 Ω, 4 Ω, and 5 Ω connected as per a given network with one dependent source (2Ix).
42. **[N]** Using mesh analysis, determine the mesh currents in a two-loop network containing a 20 V source, 5 Ω, 10 Ω, and 15 Ω resistors, and a dependent voltage source.
43. **[D]** Derive the expression for the initial values of current and its derivatives in an R-L-C series circuit at t = 0+ when a DC source is suddenly applied.
44. **[D]** Derive the complete response (natural + forced) of a series R-L circuit excited by a DC voltage source, starting from the governing differential equation.
45. **[N]** A series R-L-C circuit with R = 10 Ω, L = 0.1 H, and C = 100 µF is excited by a 100 V DC source. Determine whether the response is overdamped, critically damped, or underdamped, and find the current expression i(t).
46. **[D]** Derive the natural response of a parallel R-L-C circuit and classify the three possible cases based on the damping ratio.
47. **[N]** Using the Laplace transform method, find the current response i(t) of a series R-C circuit (R = 100 Ω, C = 10 µF) when a step voltage of 50 V is applied at t = 0.
48. **[N]** For a series R-L-C circuit with R = 50 Ω, L = 0.2 H, C = 50 µF, and a sinusoidal source of 100∠0° V at ω = 1000 rad/s, determine the current using Laplace transform techniques.
49. **[D]** Derive the transfer function of a series R-L-C circuit taken across the capacitor and locate its poles and zeros in the s-plane.
50. **[N]** Sketch the asymptotic Bode magnitude and phase plot for the transfer function H(s) = 10/[(1+s/10)(1+s/1000)].
51. **[S]** Explain the design concept and frequency response characteristics of high-pass, low-pass, band-pass, and band-stop filters.
52. **[D]** Derive the open-circuit impedance (Z) parameters of a two-port network and express V1, V2 in terms of I1, I2.
53. **[N]** For a two-port network with Z11 = 10 Ω, Z12 = Z21 = 5 Ω, Z22 = 8 Ω, determine the equivalent ABCD parameters.
54. **[D]** Derive the condition for reciprocity and symmetry of a two-port network in terms of its Z-parameters.
55. **[S]** Explain hysteresis loss and eddy current loss in a magnetic circuit, and derive Steinmetz's formula for hysteresis loss.
56. **[D]** Derive the EMF equation of a single-phase transformer from first principles, starting with Faraday's law.
57. **[N]** A 10 kVA, 400/200 V single-phase transformer has core loss of 100 W and full-load copper loss of 150 W. Determine the efficiency at full load and half load at 0.8 p.f. lagging, and the condition for maximum efficiency.
58. **[D]** Explain the operating principle and derive the torque equation of a DC motor, and describe armature control and field control methods of speed control.
59. **[N]** A DC shunt motor draws 20 A from a 220 V supply. Armature resistance is 0.5 Ω and shunt field resistance is 110 Ω. Calculate the back EMF and the developed torque at 1200 rpm.
60. **[D]** Explain the production of a rotating magnetic field in a three-phase induction motor and derive its torque equation at standstill and under running conditions, including the condition for maximum torque.

---

## D. Engineering Physics (ENSH 102) — Q61–80

61. **[D]** Derive the expression for the time period of a compound (physical) pendulum and show the condition for minimum time period.
62. **[N]** A torsion pendulum has a moment of inertia of 0.02 kg·m² and a torsional constant of 0.5 N·m/rad. Calculate its time period of oscillation.
63. **[D]** Derive the differential equation of a damped harmonic oscillator and obtain the expression for displacement. Define relaxation time and quality factor.
64. **[N]** A hall has a volume of 5000 m³ and a total absorption of 150 metric sabins. Using Sabine's formula, calculate the reverberation time.
65. **[S]** Explain the production of ultrasound using the piezoelectric effect and describe two of its engineering/medical applications.
66. **[D]** State and derive the Dulong–Petit law for specific heat of solids and explain its limitation as addressed by Einstein's theory.
67. **[D]** State Maxwell's law of equipartition of energy and use it to derive the specific heat of a diatomic gas.
68. **[N]** A composite wall consists of two layers: brick (k = 0.7 W/m·K, thickness 20 cm) and insulation (k = 0.04 W/m·K, thickness 5 cm). If the inside and outside temperatures are 25°C and 5°C, calculate the heat flux and thermal resistance using Fourier's law.
69. **[D]** Derive the expression for the fringe pattern (thickness) produced by Newton's rings in reflected light and obtain the formula for the wavelength of light used.
70. **[N]** In a Newton's rings experiment, the diameter of the 10th dark ring is 0.6 cm and that of the 5th ring is 0.34 cm using light of unknown wavelength with a plano-convex lens of radius of curvature 100 cm. Calculate the wavelength of light used.
71. **[N]** A diffraction grating has 5000 lines/cm. Calculate the angle of diffraction for the second-order maximum of light of wavelength 589 nm.
72. **[D]** Derive the expression for intensity distribution in the Fraunhofer diffraction pattern due to a single slit.
73. **[S]** Explain double refraction and the working of a Nichol prism, and describe how quarter-wave and half-wave plates produce elliptical and circular polarization.
74. **[S]** Explain the concept of population inversion and the working principle of a He-Ne laser with a neat energy level diagram.
75. **[N]** An optical fiber has a core refractive index of 1.50 and cladding refractive index of 1.47. Calculate the numerical aperture and the acceptance angle.
76. **[D]** Derive the expression for the electric field at a point on the axial line of an electric dipole, and hence obtain the field for a short dipole (r >> d).
77. **[N]** A parallel plate capacitor with plate area 0.02 m² and separation 1 mm is filled with a dielectric of εr = 5. Calculate its capacitance and the energy stored when charged to 100 V.
78. **[D]** Derive the expressions for self-inductance and mutual inductance of two coupled coils, and derive the growth of current in an L-R circuit when connected to a DC source.
79. **[D]** Starting from Maxwell's equations, derive the electromagnetic wave equation in free space and show that the speed of EM waves equals 1/√(μ0ε0).
80. **[N]** Calculate the de Broglie wavelength of an electron accelerated through a potential difference of 100 V. Also verify Heisenberg's uncertainty principle if the position of the electron is known to an accuracy of 1 Å.

---

## E. Fundamentals of Electrical and Electronics Engineering (ENEX 101) — Q81–100

81. **[N]** Using Thevenin's theorem, find the current through a 10 Ω load resistor connected across terminals A-B of a network containing a 20 V source and 5 Ω, 15 Ω resistors.
82. **[N]** Using Norton's theorem, find the equivalent current source and resistance seen by a 6 Ω load in a given resistive network with a 12 V source.
83. **[N]** Using the superposition theorem, determine the current through a 4 Ω resistor in a circuit having a 10 V voltage source and a 2 A current source acting together.
84. **[N]** Verify KVL and KCL for a two-loop resistive network with given source values and resistances (show all node/loop equations).
85. **[D]** Derive the expression for the RMS and average value of a sinusoidal waveform i(t) = Im sin(ωt) over one complete cycle.
86. **[N]** A half-wave rectified sinusoidal waveform has a peak value of 20 V. Calculate its RMS value and average value.
87. **[N]** A series R-L circuit (R = 30 Ω, L = 0.2 H) is connected to a 230 V, 50 Hz AC supply. Calculate the impedance, current, and power factor.
88. **[S]** Explain the concept of complex impedance and admittance, and represent inductive and capacitive reactance using phasor notation.
89. **[N]** For a series R-L-C circuit with R = 20 Ω, XL = 40 Ω, XC = 25 Ω supplied by 200 V AC, calculate the real, reactive, and apparent power, and draw the power triangle.
90. **[N]** A balanced three-phase star-connected load has a phase voltage of 230 V and phase current of 10 A at 0.8 p.f. lagging. Calculate the line voltage, line current, and total power. Repeat for an equivalent delta connection.
91. **[D]** Derive the equation for a series RLC circuit's resonant frequency and explain the concept of bandwidth and Q-factor at resonance.
92. **[S]** Explain the V-I characteristics of a semiconductor (p-n junction) diode and describe its ideal and practical circuit models.
93. **[N]** A full-wave bridge rectifier with a 12 V (peak) transformer secondary feeds a 1 kΩ load. Calculate the DC output voltage, ripple factor (assume no filter), and PIV of each diode.
94. **[S]** Explain the working of clipper and clamper circuits using diodes, with neat circuit diagrams and input-output waveforms.
95. **[S]** Explain the working principle of a Zener diode as a voltage regulator, and describe LED, photodiode, and varactor diode applications.
96. **[N]** For a fixed-bias BJT amplifier with VCC = 12 V, RB = 240 kΩ, RC = 2.2 kΩ, β = 100, calculate the operating point (IB, IC, VCE).
97. **[S]** Explain the T-model and π-model of a BJT for small-signal analysis, and derive the expression for voltage gain of a common-emitter amplifier.
98. **[S]** Explain the construction and working principle of a MOSFET, and describe how it is used as a logic switch (NMOS/PMOS/CMOS inverter).
99. **[D]** Derive the expression for the output voltage of an inverting and a non-inverting op-amp amplifier using the virtual ground concept.
100. **[D]** Explain Barkhausen's criterion for sustained oscillations, and derive the frequency of oscillation for a Wien bridge oscillator using an op-amp.

---

### Notes
- Numericals marked **[N]** with illustrative values — swap in your own numbers from problem sheets if you have specific ones assigned.
- Marks-heavy chapters (per syllabus evaluation schemes) got more questions: e.g., Electric Field (Ch 2, EM) and AC Circuits/Op-amp (Fundamentals) are weighted higher.
- Say the word if you want **answers/solutions** worked out for any subset (e.g., "solve Q41–60" or "just the EM derivations") — I can do it in batches so it's manageable.
