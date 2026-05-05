# TASK

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue using `{{VIEW_TASK_COMMAND}}`. If it has a parent PRD, pull that in too.

Only work on the issue specified.

Work on branch {{BRANCH}}. Make commits and run tests.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Pay extra attention to test files that touch the relevant parts of the code.

# EXECUTION

If applicable, use RGR to complete the task.

1. RED: write one test
2. GREEN: write the implementation to pass that test
3. REPEAT until done
4. REFACTOR the code

# FEEDBACK LOOPS

Before committing, run the repo-defined quality gates. Prefer project docs or package scripts such as `npm run typecheck`, `npm run test`, `pnpm test`, `pnpm lint`, or the repo's dedicated verification script. If a scanner reports success while indexing zero files, treat that as inconclusive rather than passed.

# COMMIT

Make a git commit. The commit message must:

1. Start with `NARUKAMI:` prefix
2. Include task completed + PRD reference
3. Key decisions made
4. Files changed
5. Blockers or notes for next iteration

Keep it concise.

Avoid `git commit --no-verify`. If commit hooks are blocked by the sandbox environment after the repo-defined gates pass, record the reason in the commit message and final notes.

# THE ISSUE

If the task is not complete, leave a comment on the issue with what was done.

Do not close the issue - this will be done later.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
