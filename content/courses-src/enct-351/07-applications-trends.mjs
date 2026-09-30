import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Expert systems, NLP, vision and responsible AI',
  kicker: 'ENCT 351 · Artificial Intelligence · Chapters 6–7',
  subtitle: 'Where the algorithms go to work — and what we owe the people affected.',
  sections: [
    sec('es', '6.1', 'Expert systems', { eyebrow: 'Knowledge as rules',
      body: `<p>An ${term('expert system')} captures a specialist’s knowledge as if–then rules plus an ${term('inference engine')} that applies them: ${term('forward chaining')} starts from facts and derives conclusions; ${term('backward chaining')} starts from a goal and looks for supporting facts. A user interface and an explanation facility (“why?”) complete it. Classic examples: MYCIN (medical diagnosis), XCON (configuring computers).</p>`,
      figs: [dia(`direction: right
[Knowledge base: rules] as kb #blue
[Inference engine] as ie #violet
[Working memory: facts] as wm #amber
[User interface + explanation] as ui #mint
ui -> wm : facts
wm -> ie
kb -> ie
ie -> wm : new facts
ie -> ui : conclusion + why
@0 ui -> wm : symptoms
@1 wm -> ie : facts
@2 kb -> ie : rules
@3 ie -> ui : diagnosis
loop 5`, 'The engine matches rules against facts until nothing new follows.', { caption: 'expert system architecture' })],
      worked: [step('Rules: R1 fever∧rash → measles-suspect; R2 measles-suspect∧contact → measles. Facts: fever, rash, contact.', '', { toc: 'Given' }), step('Forward chaining: R1 fires (adds measles-suspect), then R2 fires (adds measles).', '', { hero: true, toc: 'Forward chain' })],
      qs: [q('fwd', 'Forward chaining proceeds from…', ['Known facts toward conclusions.', 'Backward chaining starts from a goal.'], [['A goal back to facts.', 'That is backward chaining.'], ['Random guesses.', 'No.']])] }),
    sec('nlp', '6.2', 'Natural language processing', { eyebrow: 'Language',
      body: `<p>NLP works through levels: phonetic, morphological (word forms), lexical, syntactic (structure — parse trees), semantic (meaning), pragmatic (context). Challenges: ambiguity (“I saw the man with the telescope”), idiom, context. Modern methods pre-train large neural language models on huge text and adapt them to translation, summarisation, question answering and dialogue.</p>`,
      qs: [q('amb', '“I saw the man with the telescope” is hard because it is…', ['Syntactically ambiguous — two parse trees.', 'Who has the telescope?'], [['Too short.', 'Not the issue.'], ['Written in code.', 'No.']])] }),
    sec('vis', '6.3', 'Computer vision and robotics', { eyebrow: 'Seeing and acting',
      body: `<p>A vision pipeline: acquire an image, pre-process (denoise, normalise), extract features (edges, corners, learned features), detect or classify objects, interpret the scene. A robot adds sensing (cameras, lidar, encoders), planning (search, A*), control (feedback loops) and actuators. Self-driving cars combine all of them.</p>`,
      figs: [dia(`direction: right
[Sensors: camera, lidar] as s #blue
[Perception: detect objects] as p #mint
[Planning: choose a path] as pl #violet
[Control: steer, brake] as c #amber
(Vehicle moves) as v
s -> p
p -> pl
pl -> c
c -> v
v --> s : new view of the world
@0 s -> p : frame
@1 p -> pl : objects
@2 pl -> c : trajectory
@3 c -> v : commands
loop 5`, 'Perceive, plan, act — the agent loop again.', { caption: 'a robot’s pipeline' })],
      qs: [q('plan', 'In the robot pipeline, which stage decides the route?', ['Planning.', 'Perception interprets the scene; control executes the plan.'], [['Sensing.', 'It only measures.'], ['Control.', 'It follows the planned path.']])] }),
    sec('emerging', '7.1', 'Sequence models, federated learning, edge AI', { eyebrow: 'Trends',
      body: `<p>Sequence-to-sequence models turn one sequence into another (translation) with an encoder and decoder, now built with attention. ${term('Federated learning')} trains a shared model across many devices without collecting their raw data: each device computes an update locally and only the updates are averaged centrally (privacy). ${term('Edge AI')} runs models on the device (phone, camera) for low latency and privacy, with compression (quantisation, pruning) to fit.</p>`,
      figs: [dia(`mode: sequence
[Server] as s
[Phone A] as a
[Phone B] as b
s -> a : current model
s -> b : current model
a -> a : train on local data
b -> b : train on local data
a --> s : weight update only
b --> s : weight update only
s -> s : average the updates`, 'Raw data never leaves the devices.', { caption: 'one round of federated learning' })],
      qs: [q('fed', 'In federated learning what is sent to the server?', ['Model updates, not raw data.', 'That protects privacy.'], [['All user data.', 'That is centralised training.'], ['Nothing.', 'Then nothing is learned.']])] }),
    sec('ethics', '7.2', 'Ethics and responsible AI', { eyebrow: 'Consequences',
      body: `<p>Models inherit bias from data and can harm people: unfair decisions in hiring or lending, invasive surveillance, opaque reasoning, misinformation, energy cost. Principles: fairness, transparency and explainability, accountability, privacy, safety and robustness, human oversight. Practice: audit data and outcomes across groups, document models, test adversarially, keep a human in high-stakes loops.</p>`,
      probs: [pr('p1', '<p>A loan model is 95% accurate overall but approves 80% of one group and 40% of another with equal repayment records. What is the problem and one remedy?</p>', 'It shows disparate impact — accuracy hides unequal error rates. Remedies: audit and rebalance the training data, add fairness constraints or post-processing thresholds per group, and keep human review for borderline cases.')],
      qs: [q('bias', 'Why can a high overall accuracy still hide unfairness?', ['Errors may be concentrated on a particular group.', 'Average performance says nothing about its distribution.'], [['Accuracy is always wrong.', 'It is fine as an average.'], ['Fair systems must be 100% accurate.', 'Not achievable.']])] }),
    sec('sust', '7.3', 'Sustainable AI', { eyebrow: 'Cost',
      body: `<p>Training large models consumes large amounts of energy. Efficiency measures: smaller models, distillation, sparse computation, reuse through transfer learning, efficient hardware, and running in regions with clean energy. Sustainable AI asks whether the benefit is worth the cost.</p>`,
      worked: [step('A training run uses 1000 MWh at 0.4 kg CO₂ per kWh.', '', { toc: 'Given' }), step('Emissions = 10⁶ kWh × 0.4 kg.', '4\\times10^5\\ \\text{kg}=400\\ \\text{tonnes}', { hero: true, toc: 'Footprint' })],
      qs: [q('dist', 'Model distillation helps sustainability by…', ['Training a small model to mimic a large one, cutting inference cost.', 'Less computation per query.'], [['Making models larger.', 'The opposite.'], ['Removing the data.', 'No.']])] }),
  ],
})
