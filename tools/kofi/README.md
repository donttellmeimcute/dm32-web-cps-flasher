# Ko-fi webhook

The flasher displays the public names returned by `GET /supporters`. The receiver accepts Ko-fi's form-encoded `POST /webhook`. It records public tips from the point at which the webhook is connected, with one entry per normalized name. The public response contains only an array of display names. The receiver stores no amounts, emails, or messages.

Deploy `worker.mjs` as a Cloudflare Worker with an R2 bucket bound as `BUCKET`. In ChatGPT Sites the Worker entrypoint is `dist/server/index.js` and the hosting manifest declares the R2 binding as `"r2": "BUCKET"`. Set `KOFI_VERIFICATION_TOKEN` in the host's secret settings using the value shown in the Ko-fi Webhooks dashboard. In Ko-fi, set **Webhook URL** to the Worker URL followed by `/webhook`. Set the feed URL in `static/js/kofi-supporters.js` if the deployment uses another host.
