# Ko-fi webhook

The Cloudflare Worker receives Ko-fi's form-encoded `POST /webhook` and publishes the names via `GET /supporters`. It stores only public tip display names, with one entry per normalized name. The public response contains only an array of names.

Deploy `worker.mjs` on Cloudflare Workers with a D1 database bound as `DB`. Apply `schema.sql` to that database. In the Worker's settings, create the secret `KOFI_VERIFICATION_TOKEN` using the value shown in Ko-fi. Point Ko-fi's **Webhook URL** to `https://dm32-kofi-supporters.rkurogata.workers.dev/webhook`. If the host changes, update the feed URL in `static/js/kofi-supporters.js` and refresh the asset versions.
