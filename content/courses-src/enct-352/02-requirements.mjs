import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Requirements',
  kicker: 'ENCT 352 · Software Engineering · Chapter 3',
  subtitle: 'The cheapest bug to fix is the one caught before any code: get the right thing specified.',
  sections: [
    sec('kinds', '3.1', 'Functional and non-functional', { eyebrow: 'What vs how well',
      body: `<p><b>Functional</b> requirements say what the system does (“a user can reset a password by email”). <b>Non-functional</b> requirements constrain how: performance, security, usability, availability, portability. A good requirement is ${term('testable')}: “responds in under 2 s for 95 % of requests” not “fast”.</p>`,
      qs: [q('nf', '“The site must handle 1000 users at once” is…', ['A non-functional (performance) requirement.', 'It constrains quality, not a feature.'], [['Functional.', 'No new behaviour is described.'], ['A design decision.', 'It states a need, not a solution.']])] }),
    sec('elic', '3.2', 'Eliciting requirements', { eyebrow: 'Finding out',
      body: `<p>Techniques: interviews, questionnaires, observation, workshops, prototypes, studying existing documents. Stakeholders disagree; requirements must be negotiated and prioritised (e.g. MoSCoW: must, should, could, won’t).</p>`,
      figs: [dia(`mode: sequence
[Analyst] as a
[Stakeholder] as s
[Requirements doc] as d
a -> s : interview
s --> a : needs and pains
a -> d : draft requirements
a -> s : review
s --> a : corrections
a -> d : baseline
@0 a -> s : interview
@1 s -> a : needs and pains
@2 a -> d : draft requirements
@3 a -> s : review
@4 s -> a : corrections
@5 a -> d : baseline`, 'Elicit, draft, review, baseline.', { caption: 'elicitation loop' })],
      qs: [q('moscow', 'In MoSCoW, “won’t” means…', ['Not in this release (agreed).', 'It documents scope out.'], [['Never, ever.', 'Only for now.'], ['A rejected user.', 'Not people.']])] }),
    sec('story', '3.3', 'Use cases and user stories', { eyebrow: 'Capturing behaviour',
      body: `<p>A ${term('use case')} describes an actor achieving a goal in steps, with alternate flows for failures. A <b>user story</b>: “As a <i>role</i> I want <i>goal</i> so that <i>benefit</i>”, with acceptance criteria. Stories are small and estimated in points.</p>`,
      figs: [dia(`{Use case: Withdraw cash | actor: Customer ; goal: get money | pre: has card ; post: balance reduced}`, 'A use case as a card.', { caption: 'use case' })],
      qs: [q('us', 'A good user story ends with…', ['The benefit (“so that…”).', 'It explains the value.'], [['The database schema.', 'Implementation detail.'], ['A deadline only.', 'Not its purpose.']])] }),
    sec('srs', '3.4', 'The SRS', { eyebrow: 'The document',
      body: `<p>A Software Requirements Specification (IEEE 830/29148) contains: introduction (purpose, scope, definitions), overall description (users, constraints), specific requirements (functional, external interfaces, performance, design constraints), and appendices. It must be complete, consistent, unambiguous, verifiable and traceable.</p>`,
      qs: [q('srsq', 'Which requirement is ambiguous?', ['“The system shall be user-friendly.”', 'Cannot be tested.'], [['“Login completes within 2 s.”', 'Measurable.'], ['“Passwords hash with bcrypt.”', 'Verifiable.']])] }),
    sec('valid', '3.5', 'Validation and change', { eyebrow: 'Keeping them right',
      body: `<p>Validate by reviews, prototypes and test-case writing. Requirements change; manage change with a recorded process: request → impact analysis → approval → update and trace. Traceability links each requirement to design, code and tests.</p>`,
      worked: [step('A project has 120 requirements; 24 change after baseline.', '', { toc: 'Data' }), step('Volatility = 24/120.', '20\\%', { hero: true, toc: 'Volatility' })],
      qs: [q('vol', 'High requirement volatility suggests…', ['An iterative process and strict change control.', 'Plan for change.'], [['Freeze everything.', 'Unrealistic.'], ['Skip validation.', 'Makes it worse.']])],
      probs: [pr('p-vol', '<p>200 requirements, 30 changed. Volatility?</p>', '30/200 = <b>15 %</b>.')] }),
    sec('fp', '3.6', 'Sizing from requirements: function points', { eyebrow: 'Measure before you build',
      body: `<p>Function points count user-visible functions: external inputs (EI), outputs (EO), inquiries (EQ), internal files (ILF), external interfaces (EIF), each weighted by complexity. Unadjusted FP = Σ count × weight; multiply by a value adjustment factor (0.65–1.35).</p>`,
      worked: [step('Average weights: EI 4, EO 5, EQ 4, ILF 10, EIF 7. Counts: EI 10, EO 6, EQ 5, ILF 4, EIF 2.', '', { toc: 'Counts' }), step('UFP = 40 + 30 + 20 + 40 + 14.', 'UFP=144', { hero: true, toc: 'Total' })],
      qs: [q('fpq', 'Function points are useful because they are…', ['Independent of programming language.', 'They measure functionality, not lines.'], [['Measured after coding.', 'They can be counted from requirements.'], ['Always exact.', 'Judgement is involved.']])] }),
  ],
})
