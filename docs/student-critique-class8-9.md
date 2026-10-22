# SIMBLIP — a strict Class 8/9 student's critique

Persona: Aanya, 14, Class 9. Wants to learn light, sound, gravity, electricity. Impatient, phone-native, grades everything harshly.

Evidence tags: **[SAW]** = observed in the running app (localhost, 1366x768, local Ollama `simblip-lite-q8`) · **[CODE]** = confirmed by reading the repo · **[NOT TESTED]** = could not reach it this round.

Scope honesty: I exercised the landing page, the Assistant (3 prompts), the Lesson Player (1 topic), the Courses panel and the Components panel. I did NOT get to: pen/shape drawing, circuits, double-slit, DSA lab, Step Lab, PDF/doc pages, walkthrough demo, Recall, mobile layout, assignments. Treat those as untested, not as fine.

---

## A. "This app is not for me" (audience)

1. **I can't even get in.** Landing says "There is no public sign-up. Your institution is provisioned for you." A kid with a laptop at home cannot try it. No "try a demo" button. [SAW]
2. **Every course is university.** Courses panel: *ENCT 101 Computer Programming (C), ENEX 101 Basic Electrical Engineering, ENEX 152 Digital Logic*. Nothing for Class 8/9 science (light, sound, force, electricity basics, magnets). `content/courses/` is all ENCT/ENEX/ENSH/ENCE. [SAW][CODE]
3. **The words are for engineers.** Landing: "Kirchhoff-solved R/L/C, diodes, op-amps at 120 Hz", "Huygens–Fresnel phasor sum", "Born rule". I understood none of it. Components: "Reference Point", "Dielectric Medium", "Heat Source", "Damper", "Hinge". [SAW]
4. **No age/level setting.** Nowhere to say "I'm in Class 9", so the AI and lessons can't adjust difficulty or vocabulary. [SAW]

## B. The AI assistant (this is where I got angry)

5. **Slow.** "why is the sky blue? show me" → "Thinking… 10s", still running at ~55s. I'd have closed the tab at 10s. [SAW]
6. **It answered the wrong question, then failed.** The sky-blue request produced a double-slit setup (`light-source`, `aperture`), then: *"The model couldn't produce a valid simulation… unknown kind 'aperture' — not a SimScript component"*. Sky-blue is scattering, not slits. [SAW]
7. **It shows me code.** The reply is a wall of `var sys = create("system", {...})`. I'm 14 and asked a science question; I don't want a script to "review". Same for "Built it — review the script, then add it to the canvas." [SAW]
8. **"Add to canvas" is offered even on the failed script.** After the "couldn't produce a valid simulation" error the button is still there. [SAW]
9. **"A ball that bounces" gave me a mass on a spring.** And I also asked "tell me what is gravity" — it ignored the question completely, no explanation in words. [SAW]
10. **The thing it built doesn't work.** After adding: toast *"Spring is not attached at both ends — it applies no force, so nothing will move."* The AI made a broken sim and the app admits it only after dropping it on my page. [SAW]
11. **It dumps onto my existing page.** The new objects landed on top of the old lesson (37 → 46 objects) with yellow dashed lines through my flowchart. No "new page for this", no placement away from existing stuff. [SAW]
12. **The note it wrote is nonsense.** "Each swing is shorter than the last because the ball bounces with speed 8 m/s on each side" — a bouncing ball and a swing mixed together. A kid would learn something false. [SAW]
13. **Learn / Answer / Manual / Auto / Recall · 2 due / model dropdown "simblip-lite-q8:latest" / "Server".** Too many controls with no explanation. What is "Recall"? Why do I pick a model? [SAW]
14. **The assistant never says "I can't do that" in kid words.** Errors are developer text ("unknown kind", "publishes no data and cannot be plotted"). [SAW]

## C. "Teach me X" Lesson Player

15. **First lesson takes 2+ minutes to build** ("about a minute the first time" — it was longer; steps 1→5 took ~2.5 min). Progress is "Step 4 of 5" with no preview of what's coming. [SAW]
16. **Build is lost if the page reloads/session drops.** My first sound lesson vanished; I had to ask again. [SAW]
17. **Lesson started at the last scene.** After building, the player bar read "Real-world use", progress bar full, caption box empty. I never saw scene 1. [SAW — needs a second look; could be timing]
18. **The physics is wrong for the topic.** "How sound travels" gave "Wave on a string. The speed is v = sqrt(4gH)… Change the rod mass." Sound in air isn't a string and doesn't depend on rod mass or g. [SAW]
19. **The slider is labelled "Rod mass (kg)" for a sound lesson.** Why is a rod involved? [SAW]
20. **Stage objects sit off-screen.** The note was cut off at the top edge and the canvas below was empty at 63% zoom. [SAW]
21. **Old lesson junk stays.** The "Ohm's law" lesson tab was duplicated (two tabs both "Lesson: Oh…"), and the same Ohm's-law formula card was stamped ~9 times on one page. [SAW]
22. **Player controls float over other panels.** The lesson bar and caption box draw over the Components panel and cover "Heat Source"/other tiles. [SAW]
23. **Speed shows "0.75x" by default** — slower than normal, with no explanation why. [SAW]

## D. Canvas / notebook

24. **The first thing I see is a messy diagram.** Flowchart wires overshoot past the edge, cross each other and run through the labels ("voltage", "power" floating). Looks broken, not helpful. [SAW]
25. **Wires/arrows from the lesson loop around objects** with long right-angle detours instead of short lines. [SAW]
26. **Panels feel laggy and ghosty.** Sidebar panels open after ~1–2s; a translucent smear of the previous panel stayed visible at the left edge; clicking the Assistant icon once didn't seem to open it. [SAW]
27. **Cold load is slow.** Reload sits on "Checking your session…" for 10+ s (dev build, but kids on school Wi-Fi will see worse). [SAW]
28. **Collapsed side panel leaves a stray strip.** Closing the Assistant left a half-transparent blank column. [SAW]
29. **Too many unlabelled icons.** Left rail has 8 icons, header has ~12, bottom toolbar 11. Tooltips only. No "start here". [SAW]
30. **Console is full of `Cloud db 500` errors** (14 uncaught promise rejections) while the header cheerfully says "Synced". My work may not be saved and nobody tells me. [SAW]

## E. Landing page

31. **Hero text is nearly invisible at first** ("Your drawings become experiments" — faded grey/blue on off-white) and the page below the hero is blank until animations run. [SAW]
32. **Wall of text.** Dozens of sections about "classroom OS", QR pairing, assignments — all for teachers/admins, none for the learner. [SAW]
33. **Only demo is hidden behind sign-in.** "See it in action" cards are static. [SAW]

## F. What I'd want as a student (feature asks)

34. A big "Ask anything" box that answers in **words + one picture/sim**, not code.
35. Topics by my class: Light, Sound, Motion & Force, Electricity, Heat, Magnets — each with a 2-minute interactive.
36. A visible **"Make it simple / Make it harder"** button on every explanation.
37. Quizzes with instant right/wrong + why (Recall exists but I can't tell what it is).
38. A starter page ("Try these 5 experiments") instead of an inherited, cluttered notebook.
39. Undo for "Add to canvas" as one step (it added 9 objects; I'd have to delete them by hand).
40. Fun: sounds, rewards, streaks, share-a-sim link to send to my friend.

## G. Not tested — please check yourself

Pen/shape recognition · circuit sim play · double-slit · DSA Lab · Step Lab · Doc/PDF pages · Walkthrough Demo · Recall · mobile/tablet · assignments · offline mode · QR pairing.

---

### Suggested priority (my judgment, not Aanya's)
- **P0:** #6/#8/#10 (AI can ship invalid/broken sims and still offers "Add to canvas"), #11 (dumping on the user's page), #30 (silent sync 500s), #18 (wrong science in lessons).
- **P1:** #1–#4 (audience/level), #7 (hide code), #5/#15 (latency), #17/#21 (lesson player correctness).
- **P2:** polish items B13, D24–D29, E31.
