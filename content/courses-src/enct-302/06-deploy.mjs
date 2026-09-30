import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Deployment and modern trends',
  kicker: 'ENCT 302 · Web Application Programming · Chapter 6',
  subtitle: 'Getting code from a laptop to users, repeatably and safely.',
  sections: [
    sec('env', '6.1', 'Environments', { eyebrow: 'Dev → staging → prod',
      body: `<p>Code moves through environments: <b>development</b> (your machine), <b>staging</b> (a production-like copy for final checks), <b>production</b> (real users). Configuration (URLs, secrets) comes from environment variables, never committed to the repository — the same build runs everywhere.</p>`,
      qs: [q('sec', 'Database passwords belong in…', ['Environment variables / a secrets manager.', 'Not in source control.'], [['The Git repository.', 'Leaks forever.'], ['Client-side JavaScript.', 'Everyone can read it.']])] }),
    sec('ci', '6.2', 'CI/CD pipeline', { eyebrow: 'Automation',
      body: `<p>Every push triggers: install → lint → test → build → deploy to staging → (approval) → deploy to production. A failing stage stops the line. Automated pipelines make releases boring.</p>`,
      figs: [dia(`direction: right
[Push] as a
[Lint + test] as b
[Build image] as c
[Staging] as d
[Production] as e
a -> b
b -> c
c -> d
d -> e
@0 a -> b
@1 b -> c
@2 c -> d
@3 d -> e
loop 2`, 'The token moves on only when the stage passes.', { caption: 'pipeline' })],
      qs: [q('cicd', 'Why deploy to staging first?', ['To catch problems in a production-like place before users see them.', 'Cheap insurance.'], [['It is required by HTTP.', 'No.'], ['It makes code faster.', 'No.']])] }),
    sec('cont', '6.3', 'Containers', { eyebrow: 'Same everywhere',
      body: `<p>A <b>container</b> (Docker) packages an app with its dependencies, so “works on my machine” means works everywhere. An <b>image</b> is the recipe; a container is a running instance. Kubernetes schedules, scales and heals containers across machines.</p>`,
      qs: [q('dock', 'A Docker image is to a container as…', ['A class is to an object.', 'Recipe vs running instance.'], [['An object is to a class.', 'Reversed.'], ['A file is to a folder.', 'Not the analogy.']])] }),
    sec('rel', '6.4', 'Safe release strategies', { eyebrow: 'Limit the blast radius',
      body: `<p><b>Blue–green</b>: run old (blue) and new (green) side by side, switch traffic, switch back if broken. <b>Canary</b>: send 5 % of traffic to the new version first. <b>Feature flags</b> ship code turned off. Always have a fast rollback.</p>`,
      figs: [dia(`mode: sequence
[Users] as u
[Load balancer] as l
[Old v1] as o
[New v2] as n
u -> l : requests
l -> o : 95% of traffic
l -> n : 5% canary
n --> l : errors low
l -> n : raise to 100%
@0 u -> l : requests
@1 l -> o : 95% of traffic
@2 l -> n : 5% canary
@3 n -> l : errors low
@4 l -> n : raise to 100%`, 'Promote only while the canary looks healthy.', { caption: 'canary release' })],
      worked: [step('A bug affects 2 % of requests. A 5 % canary sees it on:', '', { toc: 'Exposure' }), step('0.05 × 0.02 = 0.1 % of all traffic, instead of 2 %.', '0.001', { hero: true, toc: 'Blast radius' })],
      qs: [q('can', 'A canary release reduces risk by…', ['Exposing few users first.', 'Bad builds hurt fewer people.'], [['Testing in production blindly.', 'It is monitored.'], ['Skipping tests.', 'Tests still run.']])],
      probs: [pr('p-can', '<p>A canary takes 10 % of traffic and the bug hits 3 % of requests. What share of all traffic is affected?</p>', '0.10 × 0.03 = <b>0.3 %</b>.')] }),
    sec('perf', '6.5', 'Performance and caching', { eyebrow: 'Fast pages',
      body: `<p>Minify and compress (gzip/brotli), cache static files with long max-age and hashed names, serve from a CDN near the user, lazy-load images, avoid render-blocking scripts. Measure with Core Web Vitals: LCP (loading), INP (responsiveness), CLS (layout stability).</p>`,
      qs: [q('cdn', 'A CDN speeds up a site mainly by…', ['Serving files from a location near the user.', 'Lower distance means lower latency.'], [['Compressing the database.', 'No.'], ['Replacing HTTP.', 'No.']])] }),
    sec('trend', '6.6', 'Modern trends', { eyebrow: 'Where it is going',
      body: `<p>Serverless functions (pay per call), edge computing, server-side rendering with hydration, Progressive Web Apps (installable, offline), WebAssembly for near-native speed, WebSockets/SSE for real-time updates, and AI-assisted development. Pick the simplest architecture that meets the need.</p>`,
      qs: [q('srv', 'Serverless means…', ['You deploy functions; the provider runs and scales servers.', 'Servers still exist, but are not yours to manage.'], [['No servers exist.', 'Someone runs them.'], ['Only static files.', 'Functions run code.']])] }),
  ],
})
