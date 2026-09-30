import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Coding and testing',
  kicker: 'ENCT 352 · Software Engineering · Chapter 6',
  subtitle: 'Testing cannot prove a program correct — but well-chosen tests find most of the bugs, cheaply.',
  sections: [
    sec('std', '6.1', 'Coding practice', { eyebrow: 'Write for the next reader',
      body: `<p>Follow a coding standard: meaningful names, small functions, comments that say <i>why</i>, consistent layout, no duplicated logic. Code review catches defects and spreads knowledge. Refactoring improves structure without changing behaviour — safely, only with tests.</p>`,
      qs: [q('ref', 'Refactoring changes…', ['Structure, not behaviour.', 'Tests should still pass.'], [['Behaviour, not structure.', 'That is a feature change.'], ['Only comments.', 'Too narrow.']])] }),
    sec('levels', '6.2', 'Levels of testing', { eyebrow: 'Small to large',
      body: `<p><b>Unit</b> tests check one function; <b>integration</b> tests check modules together; <b>system</b> tests check the whole against requirements; <b>acceptance</b> tests are run by the customer. The test pyramid says: many fast unit tests, fewer integration tests, very few slow end-to-end tests.</p>`,
      figs: [dia(`direction: down
[Few: end-to-end / acceptance] as e
[Some: integration] as i
[Many: unit] as u
e -> i
i -> u`, 'The wider the layer, the more tests.', { caption: 'test pyramid' })],
      qs: [q('pyr', 'Which tests should be most numerous?', ['Unit tests.', 'Fast and cheap.'], [['End-to-end tests.', 'Slow and brittle.'], ['Manual tests.', 'Costly to repeat.']])] }),
    sec('bb', '6.3', 'Black-box techniques', { eyebrow: 'Test from the spec',
      body: `<p><b>Equivalence partitioning</b>: split inputs into classes that should behave alike and test one of each. <b>Boundary value analysis</b>: bugs cluster at edges, so test min, min+1, max−1, max and just outside. A field accepting ages 18–60 has partitions &lt;18, 18–60, &gt;60 and boundaries 17, 18, 19, 59, 60, 61.</p>`,
      worked: [step('Valid range 18–60. Boundary tests (two-value form): below, on, above each end.', '', { toc: 'Ends' }), step('Test values: 17, 18, 60, 61.', '4\\ \\text{tests}', { hero: true, toc: 'Values' })],
      qs: [q('bva', 'For inputs 1–100, which set is a boundary test?', ['0, 1, 100, 101.', 'Just outside and on both edges.'], [['25, 50, 75.', 'Mid-range only.'], ['1000, 2000.', 'Not near the edges.']])],
      probs: [pr('p-bva', '<p>A quantity field accepts 1–10. List boundary values.</p>', '<b>0, 1, 2, 9, 10, 11</b> (three-value form) — 0 and 11 are invalid.')] }),
    sec('wb', '6.4', 'White-box and cyclomatic complexity', { eyebrow: 'Test from the code',
      body: `<p>Coverage measures how much code the tests execute: statement, branch, path. Cyclomatic complexity V(G) = E − N + 2 (or decisions + 1) counts independent paths — the minimum number of test cases for basis-path coverage. V(G) above about 10 marks code that should be split.</p>`,
      figs: [dia(`direction: down
[Start] as s
[if a > 0] as d1
[if b > 0] as d2
[End] as e
s -> d1
d1 -> d2 : yes
d1 -> e : no
d2 -> e`, 'Two decisions, so V(G) = 3.', { caption: 'control-flow graph' })],
      worked: [step('Two if-statements: decisions = 2.', '', { toc: 'Decisions' }), step('Independent paths = 2 + 1.', 'V(G)=3', { hero: true, toc: 'V(G)' })],
      qs: [q('cc', 'A function has one loop and two ifs. V(G) =', ['4.', 'Decisions (3) + 1.'], [['3.', 'Forgot the +1.'], ['2.', 'Counted only ifs.']])] }),
    sec('tdd', '6.5', 'Test-driven development', { eyebrow: 'Red, green, refactor',
      body: `<p>Write a failing test (red), write just enough code to pass (green), then clean up (refactor), and repeat. The tests document behaviour and let you change code fearlessly.</p>`,
      figs: [dia(`direction: right
[Write failing test] as r
[Make it pass] as g
[Refactor] as f
r -> g : red
g -> f : green
f -> r : next behaviour
@0 r -> g
@1 g -> f
@2 f -> r
loop 3`, 'A tight loop of minutes.', { caption: 'TDD cycle' })],
      qs: [q('tddq', 'In TDD the first step is…', ['Write a test that fails.', 'It proves the test can fail.'], [['Write the code.', 'Code comes after.'], ['Refactor.', 'Last step.']])] }),
    sec('dbg', '6.6', 'Debugging and reliability', { eyebrow: 'After it fails',
      body: `<p>Reproduce, isolate (bisect the input or the history), find the cause, fix, add a regression test. Reliability is measured by MTBF; availability = MTBF/(MTBF + MTTR).</p>`,
      worked: [step('MTBF = 500 h, MTTR = 5 h.', '', { toc: 'Data' }), step('Availability = 500/505.', 'A=0.990', { hero: true, toc: 'A' })],
      qs: [q('avail', 'Halving repair time (MTTR) mainly improves…', ['Availability.', 'Less downtime per failure.'], [['MTBF.', 'Failures occur as often.'], ['Code coverage.', 'Unrelated.']])],
      probs: [pr('p-av', '<p>MTBF 900 h, MTTR 10 h. Availability?</p>', '900/910 = <b>98.9 %</b>.')] }),
  ],
})
