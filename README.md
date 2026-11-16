# Ask me about Mikey

A conversation about Mikey Leng with Morbius, his AI. One HTML file, plus one serverless function for live answers.

- `index.html` — the page (chat, constellation map, hunches). Single file, view-source-able.
- `api/chat.mjs` — streams Morbius's replies through Vercel AI Gateway (Vercel OIDC, no keys in the repo).
- `api/_brief.mjs` — everything Morbius knows. Edit this to change what he can talk about.

Env (optional):
- `AI_GATEWAY_MODEL` — defaults to `anthropic/claude-sonnet-5.5`
- `MORBIUS_LIVE=off` — switches live chat off; the page falls back to its ready-made questions.

Limits: 20 questions per visitor per 10 minutes, 600-char questions, short replies.
