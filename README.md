# Pip's Workshop — a simulated AI coworker you teach, review and delegate to

> **Simulation / Demo.** Pip is a scripted character. There are no real model calls, no connected accounts, no network requests and nothing is ever sent. The data is synthetic.

A buildless HTML/CSS/JS prototype of one idea: turning a chat habit into a **reliable recurring process** with visible control.

You work one process (a weekly hiring and ops brief) through a cutaway workshop and a chat that share the same state:

1. **Teach** — Pip starts with a small rubric (plan v1).
2. **Review** — approve, reject, or ask for a fix.
3. **Fix and rerun** — a fix writes a new plan version; earlier proof stops counting. Rerunning the same week on the same version adds no new proof.
4. **Handle exceptions** — missing or conflicting data is asked about, never silently filled. Unknown stays unknown.
5. **Delegate with evidence** — autonomy levels (L0 to L3; L4 is locked) are gated on proof across situations and on permissions *you* grant. Permissions and competence are separate. A failed spot-check or a process change lowers autonomy.

Levels borrow a human-management metaphor (situational leadership). They are demo labels, not a validated measure of AI behavior.

## Demo
Live demo: https://ai-team-world-lab.valovoysuccess.chatgpt.site — **publication pending**; this link may not work until the owner confirms it is published.

Source and feedback: https://github.com/sergevalovoi/pips-workshop · [Report a problem](https://github.com/sergevalovoi/pips-workshop/issues/new/choose)

## Run it
Open `demo/index.html` in a browser, or serve the folder with any static server. No build step. Progress is saved in your browser's `localStorage` (`fastpay.demo.v1`); **Reset demo** clears it and **Export JSON** downloads the event log.

## What is real vs simulated
Real: the state machine, persistence, rubric checks on scripted drafts, permission rules, export, reset, keyboard and mobile behavior. Simulated: Pip's drafting, questions and any "proof". No live Codex or Claude connector is included.

## Feedback wanted
Does the workshop make the teach/review/delegate loop understandable? Where did you get stuck? Please use the issue templates. This is an early hypothesis, not a finished product.

License: MIT.
