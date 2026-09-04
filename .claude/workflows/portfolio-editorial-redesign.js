export const meta = {
  name: 'portfolio-editorial-redesign',
  description: 'Implement the portfolio editorial redesign plan task-by-task, each task TDD-implemented then reviewed and fixed',
  whenToUse: 'Implements docs/superpowers/plans/2026-09-04-portfolio-editorial-redesign-plan.md on branch feat/portfolio-editorial-redesign. Safe to re-invoke in a new session: a preflight agent reads git to skip tasks already committed. Pass args {"tasks":[4,5,6,7]} to force a specific set.',
  phases: [
    { title: 'Preflight', detail: 'read git to decide which tasks are already done' },
    { title: 'Task 1 Tokens and type', detail: 'globals.css token values, next/font faces, token test' },
    { title: 'Task 2 Shell', detail: 'GridBackdrop, PageMasthead, layout, header, footer, theme toggle' },
    { title: 'Task 3 Home', detail: 'shared wave envelope, grid rebuild, bar-rise and played-tint motion' },
    { title: 'Task 4 LoopRing and About', detail: 'circular envelope mark, About two-column rebuild' },
    { title: 'Task 5 Projects', detail: 'demoGif, ProjectDemoGif, /projects/[slug], ruled rows' },
    { title: 'Task 6 Resume Blog Contact', detail: 'the three remaining pages on the grid' },
    { title: 'Task 7 Cross-cutting verification', detail: 'Playwright, build, CHANGELOG' },
  ],
}

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'What you changed, 3-8 sentences' },
    testsPass: { type: 'boolean', description: 'Did "cd app && npm test" pass on your final code? Report honestly.' },
    testOutputTail: { type: 'string', description: 'Last ~15 lines of the final npm test run' },
    lintPass: { type: 'boolean' },
    committed: { type: 'boolean' },
    commitSha: { type: 'string', description: 'Short sha of your commit, or empty string if you did not commit' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    deviations: { type: 'string', description: 'Anything you did differently from the plan/spec, and why. Empty string if none.' },
  },
  required: ['summary', 'testsPass', 'testOutputTail', 'lintPass', 'committed', 'commitSha', 'filesTouched', 'deviations'],
  additionalProperties: false,
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    blocking: {
      type: 'array',
      description: 'Only real, verified defects. Empty array if the work is sound. Do not invent nits.',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          issue: { type: 'string' },
          fix: { type: 'string', description: 'Concrete fix instruction' },
        },
        required: ['file', 'issue', 'fix'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string', description: 'Non-blocking observations, or empty string' },
  },
  required: ['blocking', 'notes'],
  additionalProperties: false,
}

const COMMON = [
  'Repo: E:\\Personal\\looper (Windows; you have both a PowerShell tool and a Bash tool). Branch feat/portfolio-editorial-redesign is ALREADY checked out.',
  'Work directly in the main checkout. Do NOT create git worktrees, do NOT switch or create branches, do NOT push, do NOT open a PR.',
  '',
  'Read these in full before writing any code:',
  '  docs/superpowers/plans/2026-09-04-portfolio-editorial-redesign-plan.md   <- authoritative about STRUCTURE',
  '  docs/superpowers/specs/2026-09-04-portfolio-editorial-redesign-design.md <- authoritative about APPEARANCE',
  '  CLAUDE.md (repo root)                                                    <- conventions and gotchas',
  '',
  'Method: TDD, exactly as the plan step ordering says. Write or adjust the test first, run it, watch it fail, then implement until it passes.',
  '',
  'Commands (from the repo root E:\\Personal\\looper):',
  '  tests: cd app && npm test',
  '  lint:  cd app && npm run lint',
  '  build: cd app && KEYSTATIC_GITHUB_CLIENT_ID=dummy KEYSTATIC_GITHUB_CLIENT_SECRET=dummy KEYSTATIC_SECRET=dummy npm run build',
  '  e2e:   cd app && npm run test:e2e',
  'The three KEYSTATIC_ dummy vars are mandatory for the build - without them it hard-fails with a misleading "Failed to collect configuration" error.',
  '',
  'HARD CONSTRAINTS (a violation fails review):',
  '  - The bar envelope array lives ONCE in app/content/wave-envelope.ts and is imported by both the home page and LoopRing. Never duplicated.',
  '  - Do NOT delete app/components/site/TerminalWindow.tsx or its test. CommandBar still renders it.',
  '  - Do NOT touch anything under app/app/tools/bgm-looper/, lambda/, or infra/.',
  '  - Placeholder content stays exactly as-is: content/resume.ts, the About copy, the your-username contact links, and demoGif left unset on bgm-looper. Pages must render correctly WITH the placeholders. Writing real content is out of scope.',
  '  - Every hover/transition is gated with the Tailwind motion-reduce: variant. Every looping animation also gets a prefers-reduced-motion rule in globals.css, beside the existing .playhead rule.',
  '  - Token values in app/app/globals.css and app/lib/portfolio-tokens.test.ts change together, in the same commit.',
  '  - No new package dependencies. Tailwind v4 is configured CSS-first in globals.css; there is no tailwind.config.js.',
  '  - Token structure stays as phase 1 set it: light values in the @theme block, dark values in :root.dark, BOTH declared in full.',
  '  - The plan text says Next.js 15 but package.json is on next ^16.3.3. Verify the installed next/font/google API in node_modules rather than trusting the plan.',
  '  - Match the surrounding code style. Surgical changes only: every changed line must trace to this task. Do not refactor or "improve" adjacent code.',
  '',
  'You have NO browser. The plan-step lines that say "Browser: ..." are a human manual pass done later. Never claim you verified anything visually.',
  '',
  'Finish by committing: one Conventional Commit (feat:/refactor:/test:/style: as appropriate) scoped to this task, whose message ends with the trailer line:',
  'Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>',
  'Report the real test and lint results in your structured output, including failures. Never report testsPass true unless you saw a green run.',
].join('\n')

const TASKS = [
  {
    id: 1,
    title: 'Task 1 Tokens and type',
    heading: '### Task 1: Tokens and type',
    extra: [
      'Spec section 9 holds the contrast table you must assert; spec section 2 holds the ground/ink/muted/accent/peak values for both modes; spec section 7 holds the font fallback stacks.',
      'Add --color-rule-heavy (full ink in light, rgba(236, 234, 229, 0.72) in dark) and one assertion that dark rule-heavy still clears 3:1 against the dark ground - it is a graphic, not text.',
      'Delete --font-mono and --font-sans, add --font-display and --font-ui. Anything currently using font-mono/font-sans utility classes (app/app/layout.tsx body, app/app/(site)/layout.tsx) must be updated to the new tokens in this task so nothing is left referencing a deleted token.',
      'Keep the TERMINAL block of the token test untouched. Keep the :root terminal-chrome variables in globals.css untouched.',
      'Load Instrument_Serif (400 plus italic) and IBM_Plex_Sans (400/500/600) via next/font/google in app/app/layout.tsx, each with a variable: and the spec section 7 fallbacks, applied to <html>. No <link> to fonts.googleapis.com anywhere.',
      'Verify with the build command too, not just the tests.',
    ].join('\n'),
  },
  {
    id: 2,
    title: 'Task 2 Shell',
    heading: '### Task 2: The shell - layout, header, footer',
    extra: [
      'Grid: 12 columns, 24px gutters, 40px page margins, collapsing to one column at 20px margins under sm. Column rules visible at 14% ink (--color-line).',
      'GridBackdrop renders the 12 visible column rules, is aria-hidden, and must not trap pointer events.',
      'PageMasthead: eyebrow (12px uppercase, 0.14em tracking), serif title, a 2px rule beneath, and an optional right-hand slot rendered only when passed. The title is the page h1.',
      'SiteHeader: keep every existing link and href so the existing assertions still pass. Add the divider, the command-K trigger and the icon toggle in the order the spec describes; the BGM Looper action bar stays last.',
      'ThemeToggle becomes a sun/moon inline SVG with a crossfade plus rotate on the 160ms interaction curve, motion-reduce: gated. Test first that its aria-label names the NEXT state ("Switch to light mode" while dark). The existing dark-class and localStorage assertions must keep passing untouched.',
      'SiteFooter: ruled top, items as a wrapping list, copyright centred beneath a hairline under sm. Keep the existing text content assertions.',
      'Mobile hit targets stay at least 44px.',
    ].join('\n'),
  },
  {
    id: 3,
    title: 'Task 3 Home',
    heading: '### Task 3: Home',
    extra: [
      'Step 1 is a PURE MOVE: lift HEAD, BODY, WAVE and PEAK out of app/app/(site)/page.tsx into app/content/wave-envelope.ts and import them back. The existing home page test must pass unchanged after that move and before anything else is touched. Commit-wise this can be one commit with the rest, but do the move and verify it first.',
      'Then rebuild the page on the grid: name at 148px over two lines (66px under 768px), lede in columns 1-5, the three pipeline settings as a ruled 3-row table in 8-12, the waveform full width over a 2px baseline with head/tail called out, action bar last. No masthead - the name is the masthead.',
      'The pipeline setting values are the real ones from lambda/src/looper/ - read them there to confirm: -14.0 LUFS, 50ms crossfade, top_db 40. Read those files, do not edit them.',
      'Motion in globals.css: bars rise from the baseline on load, 560ms, 8ms stagger, left to right, ONCE per page load and never on scroll; the played region carries a 10% accent tint on the 9s linear loop clock that resets at the wrap with no visible seam. Both get a prefers-reduced-motion off-switch beside the existing .playhead rule (bars stand at full height, tint absent).',
      'Update the home page test for the new structure but keep its existing link assertions.',
    ].join('\n'),
  },
  {
    id: 4,
    title: 'Task 4 LoopRing and About',
    heading: '### Task 4: LoopRing and About',
    extra: [
      'LoopRing imports the shared envelope from app/content/wave-envelope.ts. Bar i is placed at -90deg + i * (360/n), so index 0 sits at twelve o-clock and the sequence closes onto its own start.',
      'The first and last HEAD.length bars carry the accent; bars over PEAK carry the peak colour; the rest carry the ink. Same rules as the linear figure.',
      'Put the placement transform on a wrapper element so the inner span stays free for its own animation. Props: radius, scale. Roughly 60 absolutely-positioned spans, no image asset, no canvas, no dependency.',
      'A hairline hand sweeps once per 9s loop; a "Tail -> head" mark appears for about 3% of the cycle as the wrap passes twelve o-clock. That mark is the only accent event. Under reduced motion the hand parks and the mark stays visible.',
      'Tests must assert the ring reads the array length rather than hard-coding a count, and that no motion class is applied when prefers-reduced-motion is set.',
      'About page: display-face opening sentence, two body paragraphs in columns 1-6, LoopRing in 8-12 above the small metadata list. The bracketed placeholder copy stays visible and unchanged.',
    ].join('\n'),
  },
  {
    id: 5,
    title: 'Task 5 Projects',
    heading: '### Task 5: Projects list and the detail page',
    extra: [
      'ProjectDemoGif uses a plain <img>, NOT next/image - next/image re-encodes and breaks GIF animation. The @next/next/no-img-element eslint disable must carry that reason inline as a comment. alt, width and height are required props and pass through; a priority prop controls loading (eager vs lazy).',
      'The detail page at app/app/(site)/projects/[slug]/page.tsx uses generateStaticParams() over app/content/projects.ts and calls notFound() on an unknown slug.',
      'Test the GIF section both ways - present when demoGif is set, cleanly absent (omitted, not stubbed) when it is not. bgm-looper leaves demoGif unset, so use a fixture for the set case.',
      'Detail page layout per spec section 4: back-to-index link, masthead with the project name and an "Open the tool" action bar in the right slot, the GIF at 16:9 across columns 1-8 with priority, "built with" and "settings" in 10-12, then the description in 1-5 beside a numbered four-step list in 7-12.',
      'The four steps are the real pipeline order from lambda/src/looper/pipeline.py - read it to confirm: trim at top_db 40, normalize to -14.0 LUFS, beat-aligned loop point, 50ms equal-power crossfade.',
      'The list rows now link to /projects/[slug], not project.href - update the existing assertion to match. Ruled rows with the index number, serif name, description capped at 46ch, metadata in 9-11 and the chevron in column 12. Hover: 12px indent plus a 10% accent wash wiping across plus an 8px chevron slide, all on one 200ms curve, motion-reduce: gated.',
    ].join('\n'),
  },
  {
    id: 6,
    title: 'Task 6 Resume Blog Contact',
    heading: '### Task 6: Resume, Blog, Contact',
    extra: [
      'Resume: dates in columns 1-2 (accent, tabular-nums), role and org in 3-8, bullets in 9-12, 1px rule between entries, PageMasthead with the Download PDF action bar in the right slot. It must render correctly against the single placeholder entry in content/resume.ts, which you do not edit.',
      'Blog: BlogList rows share the projects rhythm - date in 1-2, serif title plus summary in 3-9, tags right in 10-12. Keep the existing slug/href assertions.',
      'Contact: ruled rows, label in 1-2, value at 34px serif in 3-10, arrow in 11-12. The your-username GitHub and LinkedIn placeholders stay exactly as they are.',
      'All three pages use PageMasthead and the shared grid from Task 2.',
    ].join('\n'),
  },
  {
    id: 7,
    title: 'Task 7 Cross-cutting verification',
    heading: '### Task 7: Cross-cutting verification',
    extra: [
      'Run cd app && npm run test:e2e. If the Playwright browsers are not installed, run npx playwright install chromium first; if that fails for environment reasons, say so plainly in deviations rather than skipping silently.',
      'Update e2e/navigation.spec.ts for the new /projects/[slug] hop and e2e/theme.spec.ts for the icon toggle. e2e/a11y.spec.ts must pass UNCHANGED on every page including the new one - if it fails, fix the page, never the assertion.',
      'Run the full build with the three KEYSTATIC_ dummy vars. Confirm no new dependency appears and that no fonts.gstatic.com or fonts.googleapis.com URL is emitted into the built output (grep the .next output).',
      'Add exactly one entry under ## [Unreleased] in CHANGELOG.md at the repo root, in Keep a Changelog format, describing this redesign.',
      'Do NOT do the manual browser matrix and do not claim it - a human does that. Report in deviations anything you could not verify.',
    ].join('\n'),
  },
]

function implPrompt(t, prior) {
  return [
    COMMON,
    '',
    '========================================',
    'YOUR TASK: ' + t.title + ' ONLY.',
    'Read the plan section headed exactly:  ' + t.heading,
    'Implement every one of its steps, in order. Do not start any other task.',
    '========================================',
    '',
    'Task-specific requirements distilled from the spec (the spec itself is still authoritative - read it):',
    t.extra,
    prior ? '\nContext from earlier tasks in this same branch (already committed, build on them, do not redo them):\n' + prior : '',
  ].join('\n')
}

function reviewPrompt(t, impl, lens) {
  const lenses = {
    spec: [
      'You are the SPEC-COMPLIANCE reviewer. Check the implementation against the plan and the spec, not against your own taste.',
      'Read docs/superpowers/plans/2026-09-04-portfolio-editorial-redesign-plan.md section "' + t.heading + '" and the referenced sections of docs/superpowers/specs/2026-09-04-portfolio-editorial-redesign-design.md.',
      'Verify each numbered step of the task actually happened in the diff. Specifically check:',
      '  - every hard constraint in the plan Global Constraints list holds',
      '  - the envelope array is not duplicated; TerminalWindow.tsx still exists; nothing under app/app/tools/bgm-looper, lambda/ or infra/ changed',
      '  - placeholder content is unchanged',
      '  - motion-reduce: gating on interactions and a prefers-reduced-motion rule for any looping animation',
      '  - light and dark tokens both fully declared where touched',
      '  - the tests added actually assert the behaviour the plan asks for, rather than asserting a tautology or snapshotting markup',
      '  - the claimed green test run is real: re-run cd app && npm test yourself and check',
    ].join('\n'),
    quality: [
      'You are the CODE-QUALITY reviewer, applying this repo owner\'s standing guidelines:',
      '  Simplicity first - the minimum code that solves the problem, nothing speculative. No abstractions for single-use code, no unrequested flexibility or configurability, no error handling for impossible cases. If 200 lines could be 50, say so.',
      '  Surgical changes - every changed line traces to this task. No drive-by refactors, reformatting, or "improvements" to adjacent code. Match the existing style.',
      '  No dead code left behind by these changes (unused imports, vars, helpers). Pre-existing dead code is NOT in scope - mention, never remove.',
      'Also check: TypeScript correctness, accessibility (semantics, aria, focus, 44px hit targets), no new dependency, and that nothing in the diff would break the existing 84-test suite or eslint.',
      'Run cd app && npm run lint and cd app && npm test yourself to confirm.',
    ].join('\n'),
  }
  return [
    'Repo: E:\\Personal\\looper, branch feat/portfolio-editorial-redesign. READ-ONLY review: inspect and run commands, but do NOT edit, commit, or revert anything.',
    '',
    lenses[lens],
    '',
    'The work under review is the most recent commit' + (impl.commitSha ? ' (' + impl.commitSha + ')' : '') + '. Inspect it with: git show ' + (impl.commitSha || 'HEAD') + '  and read the touched files in full.',
    'Files the implementer says it touched: ' + (impl.filesTouched || []).join(', '),
    'The implementer\'s own summary: ' + impl.summary,
    'The implementer\'s reported deviations: ' + (impl.deviations || '(none)'),
    '',
    'Report ONLY real, verified, blocking defects - things that are wrong, missing, or violate a stated constraint. An empty blocking array is the correct answer for sound work. Do not manufacture nits, do not restate the diff, and do not ask for anything the plan lists as out of scope (real content, the demo GIF recording, the manual browser pass, phase 3 3D work).',
  ].join('\n')
}

function fixPrompt(t, impl, blocking) {
  return [
    COMMON,
    '',
    '========================================',
    'YOUR TASK: fix review findings on ' + t.title + '. The implementation is already committed' + (impl.commitSha ? ' as ' + impl.commitSha : '') + '.',
    '========================================',
    '',
    impl.testsPass ? '' : 'FIRST: the implementer reported a FAILING test suite. Get cd app && npm test green. Their last output tail:\n' + impl.testOutputTail + '\n',
    'Blocking findings from the two reviewers, each to be fixed or explicitly refuted with evidence:',
    blocking.map((b, i) => (i + 1) + '. [' + b.file + '] ' + b.issue + '\n   Suggested fix: ' + b.fix).join('\n'),
    '',
    'Reviewers are not always right. If a finding is technically wrong or asks for something out of scope, do NOT implement it - explain why in your deviations field with the concrete evidence (file, line, test output) that refutes it.',
    'Fix only what the findings name. Do not expand scope.',
    'Commit the fixes as a separate Conventional Commit with the same Signed-off-by trailer.',
  ].join('\n')
}

// Resume support. A workflow run's own cache (resumeFromRunId) is session-local,
// so a NEW session recovers progress from git instead: every task ends in a
// commit on this branch, which is the only durable state that matters.
//   args.tasks: [4,5,6,7]  -> run exactly those, skip the rest
//   args.tasks omitted     -> a preflight agent reads git log and decides
const PREFLIGHT_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    workingTreeClean: { type: 'boolean' },
    completedTaskIds: { type: 'array', items: { type: 'number' } },
    remainingTaskIds: { type: 'array', items: { type: 'number' } },
    evidence: { type: 'string', description: 'The git log lines and file checks that justify the split' },
  },
  required: ['branch', 'workingTreeClean', 'completedTaskIds', 'remainingTaskIds', 'evidence'],
  additionalProperties: false,
}

let todo
if (args && Array.isArray(args.tasks)) {
  todo = new Set(args.tasks)
  log('Resuming from args.tasks: ' + args.tasks.join(', '))
} else {
  phase('Preflight')
  const pre = await agent([
    'Repo: E:\\Personal\\looper. READ-ONLY: run git and read files, but do NOT edit, commit, checkout, or stash anything.',
    '',
    'A multi-task redesign is being implemented on the branch feat/portfolio-editorial-redesign, one commit (sometimes two: an implementation plus a fix) per task. Work out which tasks are ALREADY DONE and which remain.',
    '',
    'Read docs/superpowers/plans/2026-09-04-portfolio-editorial-redesign-plan.md for what each of the 7 tasks delivers:',
    '  1 Tokens and type      - new token values in app/app/globals.css, --font-display/--font-ui, next/font faces in app/app/layout.tsx, rewritten app/lib/portfolio-tokens.test.ts',
    '  2 Shell                - app/components/site/GridBackdrop.tsx and PageMasthead.tsx exist; (site)/layout.tsx on the 12-col grid; icon ThemeToggle',
    '  3 Home                 - app/content/wave-envelope.ts exists; (site)/page.tsx rebuilt on the grid; bar-rise + played-tint keyframes in globals.css',
    '  4 LoopRing and About   - app/components/site/LoopRing.tsx exists; about/page.tsx two-column',
    '  5 Projects             - Project.demoGif; ProjectDemoGif.tsx; app/app/(site)/projects/[slug]/page.tsx exists; list rows link to /projects/[slug]',
    '  6 Resume Blog Contact  - those three pages rebuilt on the grid',
    '  7 Cross-cutting        - e2e specs updated; a CHANGELOG.md entry under ## [Unreleased] describing this redesign',
    '',
    'Method: run  git log --oneline fc245fb..HEAD  and  git status --short  and  git show --stat  on each commit, then CHECK THE ACTUAL FILES on disk for each bullet above. A commit message is weaker evidence than the file existing with the right contents. A task counts as done only if its deliverables are really there.',
    'Also report the current branch name and whether the working tree is clean.',
    'Treat a task as NOT done if you are unsure - re-running a task is recoverable, skipping one is not.',
  ].join('\n'), { label: 'preflight:git-state', phase: 'Preflight', schema: PREFLIGHT_SCHEMA })

  if (!pre) throw new Error('Preflight agent failed; re-run with explicit args.tasks')
  if (pre.branch !== 'feat/portfolio-editorial-redesign') {
    throw new Error('Wrong branch: on "' + pre.branch + '", expected feat/portfolio-editorial-redesign. Check it out and re-run.')
  }
  todo = new Set(pre.remainingTaskIds)
  log('Preflight: tasks ' + (pre.completedTaskIds.join(', ') || 'none') + ' already done; running ' + (pre.remainingTaskIds.join(', ') || 'none'))
  if (!pre.workingTreeClean) log('WARNING: working tree is not clean - uncommitted changes will be swept into the next task commit.')
}

const results = []
let carry = ''

for (const t of TASKS) {
  if (!todo.has(t.id)) {
    carry += '\n' + t.title + ' was completed in an earlier session and is already committed on this branch. Do not redo it. Inspect it with git log --oneline and by reading the files it produced.'
    log('Skipping ' + t.title + ' (already done)')
    continue
  }
  phase(t.title)
  log('Starting ' + t.title)

  let impl = await agent(implPrompt(t, carry), {
    label: 'implement:' + t.id,
    phase: t.title,
    schema: IMPL_SCHEMA,
  })

  if (!impl) {
    log('ABORT: implementer for ' + t.title + ' returned nothing.')
    results.push({ task: t.title, status: 'implementer-died' })
    break
  }

  const reviews = (await parallel([
    () => agent(reviewPrompt(t, impl, 'spec'), { label: 'review-spec:' + t.id, phase: t.title, schema: REVIEW_SCHEMA }),
    () => agent(reviewPrompt(t, impl, 'quality'), { label: 'review-quality:' + t.id, phase: t.title, schema: REVIEW_SCHEMA }),
  ])).filter(Boolean)

  const blocking = reviews.flatMap(r => r.blocking || [])
  const notes = reviews.map(r => r.notes).filter(Boolean).join(' | ')

  let final = impl
  if (blocking.length > 0 || !impl.testsPass) {
    log(t.title + ': ' + blocking.length + ' blocking finding(s)' + (impl.testsPass ? '' : ' + failing tests') + ' - dispatching fixer')
    const fixed = await agent(fixPrompt(t, impl, blocking), {
      label: 'fix:' + t.id,
      phase: t.title,
      schema: IMPL_SCHEMA,
    })
    if (fixed) final = fixed
  }

  results.push({
    task: t.title,
    summary: final.summary,
    testsPass: final.testsPass,
    lintPass: final.lintPass,
    commitSha: final.commitSha,
    filesTouched: final.filesTouched,
    deviations: final.deviations,
    blockingFound: blocking,
    reviewerNotes: notes,
  })

  if (!final.testsPass) {
    log('STOPPING after ' + t.title + ': test suite is still not green. Later tasks build on this one.')
    break
  }

  carry += '\n' + t.title + ' is done (commit ' + final.commitSha + '). It touched: ' + (final.filesTouched || []).join(', ') +
    '. Summary: ' + final.summary + (final.deviations ? ' Deviations: ' + final.deviations : '')
}

return { results, tasksCompleted: results.filter(r => r.testsPass).length, totalTasks: TASKS.length }
