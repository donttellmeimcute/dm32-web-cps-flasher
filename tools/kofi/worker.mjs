// SPDX-License-Identifier: MIT
const FLASHER_ORIGIN = "https://donttellmeimcute.github.io";
const MAX_BODY_BYTES = 65536;

async function handleTip(request, env) {
    if (!env.KOFI_VERIFICATION_TOKEN) return new Response(null, { status: 503 });
    const mime = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (mime !== "application/x-www-form-urlencoded") return new Response(null, { status: 415 });

    let event;
    try {
        const reader = request.body?.getReader();
        if (!reader) return new Response(null, { status: 400 });
        const decoder = new TextDecoder();
        let body = "";
        let size = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BODY_BYTES) {
                await reader.cancel();
                return new Response(null, { status: 413 });
            }
            body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
        event = JSON.parse(new URLSearchParams(body).get("data"));
    } catch {
        return new Response(null, { status: 400 });
    }

    const encoder = new TextEncoder();
    const expected = encoder.encode(env.KOFI_VERIFICATION_TOKEN);
    const actual = encoder.encode(typeof event?.verification_token === "string" ? event.verification_token : "");
    if (actual.length !== expected.length || !crypto.subtle.timingSafeEqual(actual, expected)) {
        return new Response(null, { status: 401 });
    }

    if ((event.type !== "Tip" && event.type !== "Donation") || event.is_public !== true) {
        return new Response(null, { status: 200 });
    }

    const name = typeof event.from_name === "string"
        ? event.from_name.normalize("NFC").replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, "").trim()
        : "";
    if (!name || name.length > 120 || name.includes("@") ||
        /^(anonymous|somebody|anónimo|anónima)$/iu.test(name)) {
        return new Response(null, { status: 200 });
    }

    await env.DB.prepare("INSERT INTO supporters (name_key, name) VALUES (?, ?) ON CONFLICT (name_key) DO NOTHING")
        .bind(name.toLowerCase(), name).run();
    return new Response(null, { status: 200 });
}

async function listSupporters(env) {
    const { results } = await env.DB.prepare("SELECT name FROM supporters ORDER BY name_key").all();
    const supporters = results.map(({ name }) => name);
    return Response.json({ supporters }, {
        headers: { "Access-Control-Allow-Origin": FLASHER_ORIGIN, "Cache-Control": "no-store" }
    });
}

export default {
    async fetch(request, env) {
        const path = new URL(request.url).pathname;
        try {
            if (path === "/webhook" && request.method === "POST") return await handleTip(request, env);
            if (path === "/supporters" && request.method === "GET") return await listSupporters(env);
            return new Response(null, { status: 404 });
        } catch {
            return new Response(null, { status: 503 });
        }
    }
};
