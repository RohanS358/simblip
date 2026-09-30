import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Quality, version control and delivery',
  kicker: 'ENCT 352 · Software Engineering · Chapters 7–9',
  subtitle: 'Keeping software good after the first release: quality assurance, version control, and pipelines that ship safely.',
  sections: [
    sec('qa', '7.1', 'Quality assurance', { eyebrow: 'Building quality in',
      body: `<p>Quality assurance (QA) prevents defects through process (standards, reviews, audits); quality control (QC) detects them (testing). Standards: ISO 9001, CMMI levels, ISO/IEC 25010 attributes. Reviews — inspections and walkthroughs — find defects earlier than tests.</p>`,
      qs: [q('qaq', 'Code review is an example of…', ['Quality assurance/defect detection before testing.', 'Finds defects early.'], [['Deployment.', 'Not delivery.'], ['Requirements elicitation.', 'Different phase.']])] }),
    sec('cost', '7.2', 'The cost of late bugs', { eyebrow: 'Why early matters',
      body: `<p>A defect costs roughly 1 unit to fix at requirements, ~10 in design/coding, ~100 after release. Hence reviews, static analysis and unit tests are worth their effort.</p>`,
      worked: [step('A bug costing 1 h if found in requirements costs ~10× more in coding and ~100× after release.', '', { toc: 'Ratio' }), step('So 1 h → 10 h → 100 h.', '', { hero: true, toc: 'Growth' })],
      qs: [q('late', 'Why are late-found defects costly?', ['More work depends on the wrong decision.', 'Rework grows with dependants.'], [['Testers are paid more.', 'Not the reason.'], ['Code gets slower.', 'Unrelated.']])],
      probs: [pr('p-def', '<p>A project finds 60 defects in review and 20 in testing; 10 escape. Defect removal efficiency?</p>', 'DRE = (60 + 20)/(60 + 20 + 10) = <b>88.9 %</b>.')] }),
    sec('maint', '7.3', 'Maintenance', { eyebrow: 'After release',
      body: `<p>Four kinds: <b>corrective</b> (fix bugs), <b>adaptive</b> (new environment), <b>perfective</b> (new features/performance), <b>preventive</b> (refactor). Perfective is usually the largest share. Legacy systems are re-engineered or replaced when cost exceeds value.</p>`,
      qs: [q('mt', 'Porting software to a new OS is…', ['Adaptive maintenance.', 'The environment changed.'], [['Corrective.', 'Nothing was broken.'], ['Preventive.', 'Not refactoring.']])] }),
    sec('scm', '8.1', 'Version control and branching', { eyebrow: 'Managing change',
      body: `<p>Configuration management tracks every version of every item. With Git: commit small changes, branch for features, merge via review. A common flow: <code>main</code> stays releasable; a feature branch is merged by pull request after tests pass.</p>`,
      figs: [dia(`mode: sequence
[Developer] as d
[Feature branch] as f
[Reviewer] as r
[main] as m
d -> f : commit
d -> r : pull request
r --> d : comments
d -> f : fix commit
r -> m : approve and merge
@0 d -> f : commit
@1 d -> r : pull request
@2 r -> d : comments
@3 d -> f : fix commit
@4 r -> m : approve and merge`, 'main only ever receives reviewed work.', { caption: 'pull-request flow' })],
      qs: [q('mrg', 'Why merge by pull request?', ['Review and automated checks before main changes.', 'Protects the releasable branch.'], [['Git requires it.', 'It is a convention.'], ['To delete history.', 'Not the purpose.']])] }),
    sec('ci', '9.1', 'Continuous integration and delivery', { eyebrow: 'Ship safely and often',
      body: `<p><b>CI</b>: every push is built and tested automatically. <b>Continuous delivery</b>: every passing build is deployable at a click; <b>continuous deployment</b> releases automatically. Small, frequent releases are easier to test and to roll back.</p>`,
      figs: [dia(`direction: right
[Commit] as c
[Build] as b
[Unit tests] as u
[Integration tests] as i
[Deploy staging] as s
[Deploy production] as p
c -> b
b -> u
u -> i
i -> s
s -> p
@0 c -> b
@1 b -> u
@2 u -> i
@3 i -> s
@4 s -> p
loop 2`, 'A failing stage stops the token; nothing after it runs.', { caption: 'CI/CD pipeline' })],
      qs: [q('cid', 'In a CI pipeline a failing unit test should…', ['Stop the pipeline and notify the author.', 'Broken builds never reach production.'], [['Be ignored until Friday.', 'Defeats the purpose.'], ['Skip to deployment.', 'Dangerous.']])] }),
    sec('devops', '9.2', 'DevOps and recent trends', { eyebrow: 'Looking ahead',
      body: `<p>DevOps joins development and operations: infrastructure as code, containers, monitoring, fast feedback. Other trends: microservices, cloud-native, AI-assisted coding (review its output like a junior’s), DevSecOps (security in the pipeline), low-code platforms.</p>`,
      worked: [step('Deploy frequency rises from 1 per month to 1 per day.', '', { toc: 'Before/after' }), step('That is about 30× more releases, each far smaller and easier to roll back.', '30\\times', { hero: true, toc: 'Effect' })],
      qs: [q('dvo', 'Infrastructure as code means…', ['Servers are described in versioned files and created by tools.', 'Reproducible environments.'], [['Writing code on servers by hand.', 'Opposite.'], ['Only using cloud.', 'Not the same thing.']])] }),
  ],
})
