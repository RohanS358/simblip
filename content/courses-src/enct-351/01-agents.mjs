import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Intelligent agents',
  kicker: 'ENCT 351 · Artificial Intelligence · Chapter 1',
  subtitle: 'Forget “thinking machines”: an agent senses, decides and acts. Everything in AI is a way of making that decision better.',
  sections: [
    sec('what', '1.1', 'What is AI?', { eyebrow: 'Definitions',
      body: `<p>AI has been defined four ways: systems that think like humans, act like humans (the Turing test), think rationally (logic) or act rationally. The last is the working definition: a ${term('rational agent')} does whatever is expected to maximise its performance measure given what it has perceived. Roots: philosophy, mathematics, psychology, neuroscience, linguistics and computer engineering; the field was named in 1956 (Dartmouth).</p>`,
      qs: [q('turing', 'The Turing test checks whether a machine can…', ['Converse so well that a human judge cannot tell it from a person.', 'It is a test of acting humanly.'], [['Solve all puzzles.', 'Not its aim.'], ['Win at chess.', 'Unrelated.']])] }),
    sec('agent', '1.2', 'Agents and environments', { eyebrow: 'The model',
      body: `<p>An ${term('agent')} perceives its ${term('environment')} through sensors and acts on it through actuators; its behaviour is a mapping from the percept history to an action. A thermostat, a robot vacuum and a chess program all fit.</p>`,
      figs: [dia(`direction: right
[Environment] as e #grey
[Sensors] as s #blue
[Agent program: decide] as a #violet
[Actuators] as c #mint
e -> s : percepts
s -> a
a -> c : action
c -> e : changes the world
@0 e -> s : percept
@1 s -> a : sensed state
@2 a -> c : decision
@3 c -> e : action
loop 5`, 'Press Simulate: the perceive–decide–act loop.', { caption: 'the agent loop' })],
      qs: [q('loop', 'In the agent model, actions…', ['Change the environment, which produces new percepts.', 'The loop repeats.'], [['Are fixed in advance.', 'Decisions depend on percepts.'], ['Never affect percepts.', 'They do.']])] }),
    sec('types', '1.3', 'Kinds of agent', { eyebrow: 'Increasing sophistication',
      body: `<p>${term('Simple reflex')}: condition–action rules on the current percept (“if the floor is dirty, suck”). ${term('Model-based reflex')}: keeps internal state about what it cannot see. ${term('Goal-based')}: chooses actions that reach a goal (needs search and planning). ${term('Utility-based')}: maximises a measure of how good outcomes are, handling trade-offs. ${term('Learning')} agents improve from experience with a critic and a learning element.</p>`,
      figs: [dia(`direction: right
[Simple reflex] as a #grey
[Model-based] as b #blue
[Goal-based] as c #mint
[Utility-based] as d #amber
[Learning] as e #violet
a -> b : add memory
b -> c : add goals
c -> d : add preferences
d -> e : add learning`, 'Each type adds one ingredient.', { caption: 'agent types' })],
      qs: [q('utility', 'When do you need a utility-based rather than goal-based agent?', ['When there are several ways to reach the goal and some are better (faster, safer, cheaper).', 'Utility ranks outcomes; a goal only says done or not.'], [['When the goal is unknown.', 'Different issue.'], ['When the environment is static.', 'Not the reason.']])] }),
    sec('env', '1.4', 'Properties of environments', { eyebrow: 'Why problems differ',
      body: `<p>Fully vs partially ${term('observable')}; ${term('deterministic')} vs stochastic; ${term('episodic')} vs sequential; ${term('static')} vs dynamic; ${term('discrete')} vs continuous; single vs multi-agent. Chess is fully observable, deterministic, sequential, static, discrete, two-agent. Driving is partially observable, stochastic, dynamic and continuous — much harder.</p>`,
      probs: [pr('p1', '<p>Classify a game of poker on observability and determinism.</p>', 'Partially observable (other hands are hidden) and stochastic (the deal is random); also multi-agent and discrete.')],
      qs: [q('po', 'Which environment is partially observable?', ['Poker — opponents’ cards are hidden.', 'The agent’s percepts do not reveal the full state.'], [['Chess.', 'The whole board is visible.'], ['Tic-tac-toe.', 'Fully visible.']])] }),
    sec('agentic', '1.5', 'Agentic AI', { eyebrow: 'Today',
      body: `<p>Modern language-model “agents” use the same loop: perceive (read a goal, tool outputs), decide (plan a step), act (call a tool, run code) and observe again. The classic vocabulary applies: what is the performance measure, what is observable, what happens when the model's world model is wrong?</p>`,
      qs: [q('tool', 'A language-model agent calling a search tool is performing the role of…', ['An actuator acting on its environment.', 'The results come back as new percepts.'], [['A sensor only.', 'It acts first.'], ['A performance measure.', 'That judges success.']])] }),
    sec('knowledge', '1.6', 'Knowledge and learning', { eyebrow: 'Where intelligence comes from',
      body: `<p>Intelligence needs knowledge (facts and rules, represented so a program can use them) and the ability to learn it. Symbolic AI encodes knowledge by hand; machine learning extracts it from data. The two are combined in modern systems. The rest of the course is this split: search and logic, then learning.</p>`,
      worked: [step('An expert system has 500 hand-written rules; a neural network has 10⁶ weights learned from examples.', '', { toc: 'Contrast' }), step('Rules are inspectable but laborious; learned weights are cheap to acquire but hard to explain.', '', { hero: true, toc: 'Trade-off' })],
      qs: [q('sym', 'Symbolic AI represents knowledge as…', ['Explicit rules and facts written by people.', 'In contrast to weights learned from data.'], [['Weights only.', 'That is connectionist.'], ['Random numbers.', 'No.']])] }),
  ],
})
