# KAY // COMMAND — rebuild

This is a clean static rebuild of the Command Center wired to the existing Supabase project.

## What works now
- Executive brief loads from `kay_briefs`
- Project Center loads from `kay_projects`
- Action Center loads from `kay_tasks`
- Mark complete / reopen
- Save for later (reschedule)
- Delete task
- Add task
- Quick buttons: Urgent, At-risk, Due this week, Wedding tasks
- Speak button: browser speech capture when supported, otherwise it focuses the text box and tells you to use the iPad/iPhone keyboard mic
- Command Chat:
  - local commands work immediately without an AI key
  - AI answers work after adding `OPENAI_API_KEY` in Vercel

## Login
The app uses Supabase passwordless magic-link login and persists the session in the browser. You should not need to log in on every visit.

## Deploy
Upload all files/folders in this package to the root of the `kay-command` GitHub repository. Then connect that repo to the Vercel `kay-command` project.

### Optional AI chat
In Vercel:
Settings → Environment Variables → add `OPENAI_API_KEY`
Then redeploy.

The public Supabase publishable key in `index.html` is intentionally safe for browser use; authorization is enforced by Supabase RLS.
