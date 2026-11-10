import type { PassportSnapshot } from "@casitrace/contracts";

/**
 * Server-rendered public pages (roadmap-v2 P7): readable without JavaScript, small, accessible,
 * light/dark aware. Every value is escaped.
 */
export type Lang = "en" | "it";
export const LANGS: Lang[] = ["en", "it"];

const T = {
  en: {
    lot: "Lot",
    producer: "Producer",
    verifiedBusiness: "Verified business",
    unverifiedBusiness: "Business not verified by Casitrace",
    origin: "Origin",
    cultivars: "Cultivars",
    harvest: "Harvest",
    milling: "Milling",
    coldExtracted: "Cold extracted (≤ 27 °C)",
    notColdExtracted: "Not cold extracted",
    bestBefore: "Best before",
    journey: "Journey",
    certificates: "Certificates",
    noCertificates: "No certificates published.",
    validUntil: "valid until",
    status: "Status",
    verify: "Check this page",
    signatureOk: "Signature valid: Casitrace published exactly this content and it has not changed.",
    signatureBad: "Signature check failed. Do not rely on this page.",
    whatItMeans:
      "A signature proves the page is unchanged, not that every claim is true. Certificate statuses show what has been checked.",
    withdrawn: "The producer has withdrawn this page.",
    recall: "Product recall: do not consume this lot. Follow the producer's instructions.",
    olderVersion: "You are viewing an older version.",
    latest: "See the latest version",
    approx: "approx.",
    statuses: {
      checked: "File checked, content not yet reviewed",
      verified: "Reviewed by the producer's quality staff",
      expired: "Expired",
      revoked: "Withdrawn by the producer",
      rejected: "Rejected",
      submitted: "Awaiting checks",
      removed: "No longer available",
    } as Record<string, string>,
    steps: {
      harvest: "Harvested",
      receipt: "Received from a grower",
      milling: "Milled",
      blending: "Blended",
      bottling: "Bottled",
      processing: "Processed",
    } as Record<string, string>,
    grade: {
      extra_virgin: "Extra virgin olive oil",
      virgin: "Virgin olive oil",
      lampante: "Lampante olive oil",
      refined: "Refined olive oil",
      olive_oil: "Olive oil",
      olive_pomace_oil: "Olive-pomace oil",
    } as Record<string, string>,
    organic: "Organic (declared by the producer)",
    by: "by",
    directory: "Producer directory",
    search: "Search",
    searchHint: "Name, town or region",
    noResults: "No organisations found.",
    products: "Public product pages",
    digest: "Fingerprint (SHA-256)",
    key: "Key",
    version: "Version",
    published: "Published",
    json: "Signed data (JSON)",
    language: "Language",
  },
  it: {
    lot: "Lotto",
    producer: "Produttore",
    verifiedBusiness: "Azienda verificata",
    unverifiedBusiness: "Azienda non verificata da Casitrace",
    origin: "Origine",
    cultivars: "Cultivar",
    harvest: "Raccolta",
    milling: "Molitura",
    coldExtracted: "Estratto a freddo (≤ 27 °C)",
    notColdExtracted: "Non estratto a freddo",
    bestBefore: "Da consumarsi preferibilmente entro",
    journey: "Percorso",
    certificates: "Certificati",
    noCertificates: "Nessun certificato pubblicato.",
    validUntil: "valido fino al",
    status: "Stato",
    verify: "Verifica questa pagina",
    signatureOk:
      "Firma valida: Casitrace ha pubblicato esattamente questo contenuto e non è stato modificato.",
    signatureBad: "Verifica della firma non riuscita. Non fare affidamento su questa pagina.",
    whatItMeans:
      "La firma dimostra che la pagina non è cambiata, non che ogni dichiarazione sia vera. Lo stato dei certificati indica cosa è stato controllato.",
    withdrawn: "Il produttore ha ritirato questa pagina.",
    recall: "Richiamo del prodotto: non consumare questo lotto. Seguire le istruzioni del produttore.",
    olderVersion: "Stai visualizzando una versione precedente.",
    latest: "Vedi la versione più recente",
    approx: "circa",
    statuses: {
      checked: "File controllato, contenuto non ancora esaminato",
      verified: "Esaminato dal controllo qualità del produttore",
      expired: "Scaduto",
      revoked: "Ritirato dal produttore",
      rejected: "Respinto",
      submitted: "In attesa di controlli",
      removed: "Non più disponibile",
    } as Record<string, string>,
    steps: {
      harvest: "Raccolta",
      receipt: "Ricevuto da un olivicoltore",
      milling: "Molitura",
      blending: "Miscelazione",
      bottling: "Imbottigliamento",
      processing: "Lavorazione",
    } as Record<string, string>,
    grade: {
      extra_virgin: "Olio extravergine di oliva",
      virgin: "Olio di oliva vergine",
      lampante: "Olio di oliva lampante",
      refined: "Olio di oliva raffinato",
      olive_oil: "Olio di oliva",
      olive_pomace_oil: "Olio di sansa di oliva",
    } as Record<string, string>,
    organic: "Biologico (dichiarato dal produttore)",
    by: "da",
    directory: "Elenco produttori",
    search: "Cerca",
    searchHint: "Nome, comune o regione",
    noResults: "Nessuna organizzazione trovata.",
    products: "Pagine prodotto pubbliche",
    digest: "Impronta (SHA-256)",
    key: "Chiave",
    version: "Versione",
    published: "Pubblicato",
    json: "Dati firmati (JSON)",
    language: "Lingua",
  },
} as const;

export const pickLang = (query: string | undefined, acceptLanguage: string | undefined): Lang => {
  if (query === "it" || query === "en") return query;
  return acceptLanguage?.toLowerCase().startsWith("it") ? "it" : "en";
};

export const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

const fmtDate = (d: string | undefined, lang: Lang) =>
  d
    ? new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-GB", {
        dateStyle: "long",
        timeZone: "UTC",
      }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`))
    : "";
const country = (code: string | undefined, lang: Lang) => {
  if (!code) return "";
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

const CSS = `
:root{--bg:#f6f8f6;--surface:#fff;--ink:#16201b;--muted:#56635b;--line:#d5ddd8;--brand:#1d6b51;--ok:#1d6b51;--warn:#8a5300;--fail:#b42318;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0f1512;--surface:#161e1a;--ink:#e3eae5;--muted:#a3b0a8;--line:#2a3530;--brand:#5cc39a;--ok:#5cc39a;--warn:#f0a84a;--fail:#f97066;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:44rem;margin:0 auto;padding:20px max(16px,env(safe-area-inset-left)) 48px}
h1{font-size:1.65rem;line-height:1.2;margin:.2rem 0 .4rem;text-wrap:balance}h2{font-size:1.05rem;margin:1.6rem 0 .5rem}
.eyebrow{color:var(--muted);font-size:.85rem;text-transform:uppercase;letter-spacing:.06em}
.card{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:14px 16px;margin:12px 0}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}dt{color:var(--muted)}dd{margin:0}
ol,ul{margin:0;padding-left:1.2rem}li{margin:4px 0}.muted{color:var(--muted)}.ok{color:var(--ok)}.warn{color:var(--warn)}
.banner{border-radius:6px;padding:12px 14px;margin:12px 0;font-weight:600}.banner.fail{background:var(--fail);color:#fff}.banner.warn{border:2px solid var(--warn);color:var(--warn)}
.badge{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:1px 9px;font-size:.8rem}
.badge.ok{border-color:var(--ok)}code{font:13px/1.4 ui-monospace,Menlo,monospace;word-break:break-all}
a{color:var(--brand)}nav.lang{float:right;font-size:.9rem}footer{margin-top:2rem;font-size:.85rem;color:var(--muted)}
form.search{display:flex;gap:8px}input[type=search]{flex:1;min-width:0;padding:9px 10px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);font:inherit}
button{padding:9px 14px;border:0;border-radius:4px;background:var(--brand);color:var(--bg);font:inherit;font-weight:600}
a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
`;

const page = (lang: Lang, title: string, body: string, langLinks: string) => `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(title)}"><style>${CSS}</style></head>
<body><main>${langLinks}${body}<footer>Casitrace</footer></main></body></html>`;

const langNav = (lang: Lang, href: (l: Lang) => string) =>
  `<nav class="lang" aria-label="${T[lang].language}">${LANGS.map((l) => (l === lang ? `<strong>${l.toUpperCase()}</strong>` : `<a href="${esc(href(l))}" hreflang="${l}">${l.toUpperCase()}</a>`)).join(" · ")}</nav>`;

export interface PassportView {
  snapshot: PassportSnapshot;
  digest: string;
  signature: { kid: string; value: string };
  live: {
    latestVersion: number;
    isLatest: boolean;
    status: "published" | "withdrawn";
    recall: boolean;
    certificates: { evidenceId: string; status: string }[];
  };
  signatureValid: boolean;
}

export const renderPassport = (v: PassportView, lang: Lang) => {
  const t = T[lang];
  const s = v.snapshot;
  const base = `/p/${encodeURIComponent(s.publicId)}`;
  const versionQ = v.live.isLatest ? "" : `&v=${s.version}`;
  const title = s.product.name;
  const facts: [string, string][] = [];
  if (s.lot) facts.push([t.lot, `<code>${esc(s.lot.lotCode)}</code>`]);
  const originParts = [s.product.originRegion, country(s.product.originCountry, lang)].filter(Boolean);
  if (originParts.length) facts.push([t.origin, esc(originParts.join(", "))]);
  if (s.product.cultivars.length) facts.push([t.cultivars, esc(s.product.cultivars.join(", "))]);
  if (s.lot?.harvest)
    facts.push([
      t.harvest,
      esc(
        s.lot.harvest.from === s.lot.harvest.to
          ? fmtDate(s.lot.harvest.from, lang)
          : `${fmtDate(s.lot.harvest.from, lang)} – ${fmtDate(s.lot.harvest.to, lang)}`,
      ),
    ]);
  if (s.lot?.milling?.date) facts.push([t.milling, esc(fmtDate(s.lot.milling.date, lang))]);
  if (s.lot?.milling?.coldExtracted !== undefined)
    facts.push(["", esc(s.lot.milling.coldExtracted ? t.coldExtracted : t.notColdExtracted)]);
  if (s.lot?.bestBefore) facts.push([t.bestBefore, esc(fmtDate(s.lot.bestBefore, lang))]);
  if (s.product.organicDeclared) facts.push(["", esc(t.organic)]);
  const areas = (s.lot?.originAreas ?? [])
    .map((a) => {
      const where = [a.region, country(a.country, lang)].filter(Boolean).join(", ");
      const map =
        a.approxLat !== undefined && a.approxLon !== undefined
          ? ` <a href="https://www.openstreetmap.org/?mlat=${a.approxLat}&amp;mlon=${a.approxLon}#map=10/${a.approxLat}/${a.approxLon}" rel="noopener">${t.approx} ${a.approxLat}°, ${a.approxLon}° ↗</a>`
          : "";
      return `<li>${esc(where || "—")}${map}</li>`;
    })
    .join("");
  const live = new Map(v.live.certificates.map((c) => [c.evidenceId, c.status]));
  const certs = s.certificates.length
    ? `<ul>${s.certificates
        .map((c) => {
          const status = live.get(c.evidenceId) ?? c.statusAtPublication;
          const tone = status === "verified" ? "ok" : status === "checked" ? "" : "warn";
          return `<li><strong>${esc(c.title)}</strong>${c.scheme ? ` · ${esc(c.scheme)}` : ""}${c.issuer ? ` · ${esc(c.issuer)}` : ""}${c.validUntil ? ` · ${t.validUntil} ${esc(fmtDate(c.validUntil, lang))}` : ""}<br><span class="badge ${tone}">${esc(t.statuses[status] ?? status)}</span></li>`;
        })
        .join("")}</ul>`
    : `<p class="muted">${t.noCertificates}</p>`;
  const journey = s.journey.length
    ? `<h2>${t.journey}</h2><ol class="card">${s.journey
        .map(
          (j) =>
            `<li><strong>${esc(t.steps[j.step] ?? j.step)}</strong>${j.date ? ` · ${esc(fmtDate(j.date, lang))}` : ""}${j.place ? ` · ${esc(j.place)}` : ""}${j.by ? ` · ${t.by} ${esc(j.by)}` : ""}</li>`,
        )
        .join("")}</ol>`
    : "";
  const producerPlace = [s.producer.city, s.producer.region, country(s.producer.country, lang)]
    .filter(Boolean)
    .join(", ");
  const body = `
${v.live.recall ? `<p class="banner fail" role="alert">${t.recall}</p>` : ""}
${v.live.status === "withdrawn" ? `<p class="banner warn" role="status">${t.withdrawn}</p>` : ""}
${v.live.isLatest ? "" : `<p class="banner warn">${t.olderVersion} <a href="${base}?lang=${lang}">${t.latest}</a></p>`}
<p class="eyebrow">${esc(t.grade[s.product.grade ?? ""] ?? s.product.category.replaceAll("_", " "))}</p>
<h1>${esc(title)}</h1>
<p>${t.producer}: <strong>${esc(s.producer.name)}</strong>${producerPlace ? `, ${esc(producerPlace)}` : ""} <span class="badge ${s.producer.verified ? "ok" : ""}">${s.producer.verified ? t.verifiedBusiness : t.unverifiedBusiness}</span></p>
${facts.length ? `<div class="card"><dl>${facts.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${val}</dd>`).join("")}</dl></div>` : ""}
${areas ? `<h2>${t.origin}</h2><ul class="card">${areas}</ul>` : ""}
${journey}
<h2>${t.certificates}</h2><div class="card">${certs}</div>
<h2>${t.verify}</h2>
<div class="card">
<p class="${v.signatureValid ? "ok" : "warn"}"><strong>${v.signatureValid ? `✓ ${t.signatureOk}` : `✗ ${t.signatureBad}`}</strong></p>
<p class="muted">${t.whatItMeans}</p>
<dl><dt>${t.version}</dt><dd>${s.version}</dd><dt>${t.published}</dt><dd>${esc(fmtDate(s.publishedAt, lang))}</dd>
<dt>${t.digest}</dt><dd><code>${esc(v.digest)}</code></dd><dt>${t.key}</dt><dd><code>${esc(v.signature.kid)}</code></dd></dl>
<p><a href="/api/v1/public/passports/${encodeURIComponent(s.publicId)}?version=${s.version}">${t.json}</a> · <a href="/api/v1/public/keys">${t.key}</a></p>
</div>`;
  return page(
    lang,
    `${s.product.name} — ${s.producer.name}`,
    body,
    langNav(lang, (l) => `${base}?lang=${l}${versionQ}`),
  );
};

export interface DirectoryView {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  verified: boolean;
  description?: string | null;
  website?: string | null;
}

export const renderDirectory = (q: string, results: DirectoryView[] | null, lang: Lang) => {
  const t = T[lang];
  const list =
    results === null
      ? ""
      : results.length
        ? `<ul class="card">${results
            .map(
              (r) =>
                `<li><a href="/o/${encodeURIComponent(r.id)}?lang=${lang}">${esc(r.name)}</a> <span class="muted">${esc([r.city, r.region, country(r.countryCode ?? undefined, lang)].filter(Boolean).join(", "))}</span> ${r.verified ? `<span class="badge ok">${t.verifiedBusiness}</span>` : ""}</li>`,
            )
            .join("")}</ul>`
        : `<p class="muted">${t.noResults}</p>`;
  const body = `<h1>${t.directory}</h1>
<form class="search" method="get" action="/directory" role="search"><input type="hidden" name="lang" value="${lang}">
<label for="q" class="muted" style="position:absolute;left:-9999px">${t.searchHint}</label>
<input id="q" type="search" name="q" minlength="2" maxlength="80" value="${esc(q)}" placeholder="${t.searchHint}"><button type="submit">${t.search}</button></form>${list}`;
  return page(
    lang,
    t.directory,
    body,
    langNav(lang, (l) => `/directory?lang=${l}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  );
};

export const renderOrganisation = (
  o: DirectoryView & { passports: { publicId: string; productName: string; lotCode: string | null }[] },
  lang: Lang,
) => {
  const t = T[lang];
  const body = `<p class="eyebrow">${t.producer}</p><h1>${esc(o.name)}</h1>
<p>${esc([o.city, o.region, country(o.countryCode ?? undefined, lang)].filter(Boolean).join(", "))} <span class="badge ${o.verified ? "ok" : ""}">${o.verified ? t.verifiedBusiness : t.unverifiedBusiness}</span></p>
${o.description ? `<p>${esc(o.description)}</p>` : ""}${o.website ? `<p><a href="${esc(o.website)}" rel="noopener nofollow">${esc(o.website)}</a></p>` : ""}
<h2>${t.products}</h2>${o.passports.length ? `<ul class="card">${o.passports.map((p) => `<li><a href="/p/${encodeURIComponent(p.publicId)}?lang=${lang}">${esc(p.productName)}</a>${p.lotCode ? ` <span class="muted">· ${t.lot} ${esc(p.lotCode)}</span>` : ""}</li>`).join("")}</ul>` : `<p class="muted">—</p>`}`;
  return page(
    lang,
    o.name,
    body,
    langNav(lang, (l) => `/o/${encodeURIComponent(o.id)}?lang=${l}`),
  );
};
