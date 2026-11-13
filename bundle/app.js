/**
 * DealSeal — Anna App bundle.
 *
 * Host APIs used (declared in manifest.json → ui.host_api):
 *   anna.llm.complete({ messages, systemPrompt, maxTokens, temperature })
 *   anna.storage.get({ key }) → { value }   /   anna.storage.set({ key, value })
 *   anna.window.set_title({ title })
 *
 * When opened outside Anna the SDK import fails and the app runs in preview
 * mode: localStorage and a sample contract.
 */

import { UI_LANGS, DOC_LANG_FOR_UI, UI_LANG_NAME, setUiLang, uiLang, detectUiLang, t } from "./i18n.js";

const SDK_URL = "/static/anna-apps/_sdk/latest/index.js";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "INR", "CNY", "RUB", "AED", "CAD", "AUD", "JPY"];
const DOC_LANGUAGES = ["English", "Deutsch", "中文", "Русский", "हिन्दी", "Español", "Français", "Italiano", "Português", "Nederlands", "Polski", "Türkçe", "日本語", "한국어"];

const KEYS = {
  profile: "dealseal:profile",
  history: "dealseal:history",
  last: "dealseal:last-brief",
  theme: "dealseal:theme",
  uiLang: "dealseal:ui-lang",
};

// The contract's sections, in order, and what each must cover.
const SECTIONS = [
  ["parties", "Parties: who the freelancer and the client are, with their countries; address placeholders if not given."],
  ["scope", "Scope of work: the deliverables as a list, what the client provides, and what is NOT included. Extra work is quoted separately."],
  ["timeline", "Timeline: start, deadline and milestones; delays caused by late client input or feedback move the deadline."],
  ["payment", "Fees and payment: price and payment model, upfront payment, invoicing, days until invoices are due, late fee only if given, expenses."],
  ["revisions", "Revisions and changes: revision rounds included, how extra rounds and change requests are handled and billed."],
  ["ip", "Ownership and usage rights as set in the brief; the freelancer may show the work in their portfolio unless agreed otherwise."],
  ["confidentiality", "Confidentiality of each side's non-public information."],
  ["termination", "Termination: how either side can end the agreement, payment for work done so far, what happens to the upfront payment."],
  ["liability", "Liability and warranties: reasonable limits, such as liability capped at the fees paid."],
  ["general", "General: governing law of the freelancer's country (placeholder if unknown), entire agreement, changes only in writing."],
];
const SECTION_IDS = SECTIONS.map(([id]) => id);

const THEMES = {
  auto:  { next: "light", icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor"/></svg>' },
  light: { next: "dark",  icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' },
  dark:  { next: "auto",  icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 10.2A6 6 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7z" fill="currentColor"/></svg>' },
};

const DEFAULT_PROFILE = { name: "", role: "", country: "", email: "", dueDays: 14, lateFee: "" };

const $ = (s) => document.querySelector(s);

const state = {
  anna: null,
  profile: { ...DEFAULT_PROFILE },
  history: [],
  result: null,
  view: "contract",
  busy: false,
  status: null,
};

/* ----------------------------------------------------------------- theme */

function applyTheme(name) {
  const th = THEMES[name] ? name : "auto";
  if (th === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", th);
  const btn = document.getElementById("theme");
  if (btn) {
    const label = t(`theme.${th}`);
    btn.innerHTML = `${THEMES[th].icon}<span></span>`;
    btn.querySelector("span").textContent = label;
    btn.dataset.theme = th;
    btn.title = label;
    btn.setAttribute("aria-label", t("theme.aria", { name: label }));
  }
  try { localStorage.setItem(KEYS.theme, th); } catch {}
  return th;
}

try { setUiLang(localStorage.getItem(KEYS.uiLang) || detectUiLang()); } catch { setUiLang(detectUiLang()); }
try { applyTheme(localStorage.getItem(KEYS.theme) || "auto"); } catch { applyTheme("auto"); }

/* ------------------------------------------------------------------ host */

async function connect() {
  try {
    const mod = await import(SDK_URL);
    state.anna = await mod.AnnaAppRuntime.connect();
    $("#conn").classList.add("on");
    state.anna.window.set_title({ title: "DealSeal" }).catch(() => {});
  } catch (e) {
    state.anna = null;
    console.info("[dealseal] preview mode:", e?.message || e);
  }
  $("#conn").title = t(state.anna ? "conn.on" : "conn.preview");
}

async function load(key, fallback) {
  try {
    if (state.anna) {
      const r = await state.anna.storage.get({ key });
      return r && r.value != null ? r.value : fallback;
    }
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function save(key, value) {
  try {
    if (state.anna) await state.anna.storage.set({ key, value });
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("[dealseal] save failed", key, e);
  }
}

let saveTimer;
function saveHistorySoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(KEYS.history, state.history), 600);
}

/* -------------------------------------------------------------- language */

function applyStaticText() {
  document.documentElement.lang = uiLang();
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-ph]")) el.placeholder = t(el.dataset.i18nPh);
  for (const el of document.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
  $("#ui-lang").setAttribute("aria-label", t("uiLang.label"));
}

function changeUiLang(id) {
  const before = uiLang();
  const now = setUiLang(id);
  try { localStorage.setItem(KEYS.uiLang, now); } catch {}
  save(KEYS.uiLang, now);
  const docLang = $("#doc-lang");
  if (docLang.value === DOC_LANG_FOR_UI[before]) docLang.value = DOC_LANG_FOR_UI[now];
  renderUi();
}

function renderUi() {
  applyStaticText();
  $("#ui-lang").value = uiLang();
  applyTheme($("#theme").dataset.theme || "auto");
  $("#conn").title = t(state.anna ? "conn.on" : "conn.preview");
  renderProfile();
  renderModelFields();
  renderStatus();
  renderDoc();
  renderHistory();
}

/* --------------------------------------------------------------- prompts */

const NO_INVENT = `Never invent facts: names, addresses, company or tax numbers, amounts, percentages, dates or durations. Use only what the brief gives. Where something a contract needs is missing, write a short placeholder in square brackets in the contract language, e.g. [CLIENT ADDRESS].`;

const CONTRACT_SYSTEM = `You draft clear, fair freelance service agreements in plain language for independent freelancers. You are not a lawyer and never claim to be.
${NO_INVENT}
Use plain words and short sentences. Respond with JSON only, no markdown fences.`;

const EXTRAS_SYSTEM = `You help independent freelancers send contracts to clients and spot risks in a deal.
${NO_INVENT}
Respond with JSON only, no markdown fences.`;

const REWRITE_SYSTEM = `You edit single sections of freelance contracts. You are not a lawyer.
${NO_INVENT}
Respond with JSON only, no markdown fences.`;

const IP_TEXT = {
  afterPayment: "The client receives full ownership of the final work once the full fee has been paid. Until then the freelancer keeps all rights.",
  onDelivery: "The client receives full ownership of the final work on delivery.",
  license: "The freelancer keeps ownership; the client receives a licence to use the final work for the purpose of the project.",
};
const MODEL_TEXT = { fixed: "Fixed price for the whole project", milestones: "Paid in milestones", hourly: "Billed by the hour" };

function dealFacts(b, p) {
  const price = b.price === "" || b.price == null
    ? "[not given]"
    : b.model === "hourly" ? `${b.price} ${b.currency} per hour` : `${b.price} ${b.currency} in total`;
  return `Freelancer: ${p.name || "[not given]"}${p.role ? ` (${p.role})` : ""}, country: ${p.country || "[not given]"}${p.email ? `, email: ${p.email}` : ""}
Client: ${b.clientName}, country: ${b.clientCountry || "[not given]"}
Work: ${b.scope}
Price: ${price}
Payment model: ${MODEL_TEXT[b.model]}
Upfront payment: ${b.deposit}% of the total, due before work starts
${b.model === "milestones" ? `Milestones: ${b.milestones || "[not given: propose stages without amounts or dates, using placeholders]"}\n` : ""}Invoices due within ${p.dueDays || 14} days
Late fee: ${p.lateFee ? `${p.lateFee}% per month` : "not given, do not add one"}
Revision rounds included: ${b.revisions}
Start: ${b.start || "[not given]"}
Deadline: ${b.deadline || "[not given]"}
Ownership: ${IP_TEXT[b.ip]}`;
}

function contractPrompt(b, p) {
  const tone = b.tone === "protective"
    ? "Protect the freelancer: firm payment terms, clear limits on revisions and scope, and a cancellation fee if the client ends the project early. Stay reasonable and fair."
    : "Balanced and fair to both sides.";
  return `Draft a freelance service agreement for this deal.

${dealFacts(b, p)}

Tone: ${tone}
Language: write the whole contract in ${b.docLang}. Write dates in the usual format of that language.

Sections, in this order, with these ids:
${SECTIONS.map(([id, what], i) => `${i + 1}. ${id}: ${what}`).join("\n")}

Return exactly: {"title":"...","sections":[{"id":"parties","heading":"1. ...","body":"..."}]}
Headings are numbered. Body is plain text: paragraphs separated by a blank line, lists as lines starting with "- ". Do not add signature lines; the app adds them.`;
}

function extrasPrompt(b, p, alreadyFlagged) {
  return `For this freelance deal, write three things.

${dealFacts(b, p)}

1. email: a short, friendly email from the freelancer to the client that sends the contract, recaps price, upfront payment and deadline in one or two sentences, and asks the client to review and sign. Write it in ${b.docLang}. Sign with the freelancer's name, or [YOUR NAME] if not given.
2. summary: 4 to 6 short bullet points that explain the deal in plain words for the client. Write them in ${b.docLang}.
3. flags: up to 4 risks for the freelancer in this deal that a careful freelancer would fix before sending, for example a vague scope, no process for change requests, no milestones on a long project, or rights passing before payment. Do not repeat these, which are already flagged: ${alreadyFlagged.join("; ") || "none"}. Each flag has level "high", "medium" or "low"; section: the id of the contract section to change (${SECTION_IDS.join(", ")}); issue: one sentence; fix: one sentence on what to change. Write the flags in ${UI_LANG_NAME[uiLang()]}. If nothing is worth flagging, return an empty list.

Return exactly: {"email":{"subject":"...","body":"..."},"summary":["..."],"flags":[{"level":"medium","section":"scope","issue":"...","fix":"..."}]}`;
}

const REWRITE_TEXT = {
  simpler: "Make it simpler and easier to read, in plain words, without changing what it means.",
  protect: "Make it protect the freelancer more, with clearer payment, scope and liability limits, while staying fair and reasonable.",
};

function rewritePrompt(r, sec, kind, flag, dropped) {
  const instruction = kind === "fix" ? `Fix this issue: ${flag.issue} What to change: ${flag.fix}` : REWRITE_TEXT[kind];
  const keep = kind === "fix"
    ? "Keep every name, amount, percentage, date and duration as written, unless the fix itself requires a change."
    : "Keep every name, amount, percentage, date and duration exactly as written.";
  return `Rewrite one section of a freelance contract.

The deal:
${dealFacts(r.brief, r.profile)}

Instruction: ${instruction}
${keep}${dropped ? `\nYour previous answer dropped or changed these numbers: ${dropped.join(", ")}. Keep them exactly.` : ""}
Keep the heading's number. Keep the language of the section (${r.brief.docLang}).

Section:
heading: ${sec.heading}
body:
${sec.body}

Return exactly: {"heading":"...","body":"..."}`;
}

/* ------------------------------------------------------------- the model */

function completionText(res) {
  const c = res && res.content;
  if (!c) return "";
  if (Array.isArray(c)) return c.filter((x) => x.type === "text").map((x) => x.text).join("");
  return c.text || "";
}

function extractJson(raw) {
  const text = typeof raw === "string" ? raw : "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(t("err.noJson"));
  return JSON.parse(text.slice(start, end + 1));
}

async function ask(system, prompt, maxTokens) {
  if (!state.anna) return demoAnswer(prompt);
  const res = await state.anna.llm.complete({
    systemPrompt: system,
    messages: [{ role: "user", content: { type: "text", text: prompt } }],
    maxTokens,
    temperature: 0.4,
  });
  return completionText(res);
}

function friendlyError(err) {
  // Host errors carry a code (QUOTA_EXCEEDED…); a plain Error's name is just "Error".
  const name = `${err?.code || ""} ${err?.name || ""}`;
  if (/QUOTA|RATE/i.test(name)) return t("err.quota");
  if (/PERMISSION|DENIED|ACL/i.test(name)) return t("err.permission");
  if (err instanceof SyntaxError) return t("err.cutoff");
  return err?.message || t("err.generic");
}

function parseContract(raw) {
  const data = extractJson(raw);
  const sections = (Array.isArray(data.sections) ? data.sections : [])
    .map((s, i) => ({
      id: SECTION_IDS.includes(s.id) ? s.id : `extra-${i}`,
      heading: String(s.heading || "").trim(),
      body: String(s.body || "").trim(),
    }))
    .filter((s) => s.heading && s.body);
  if (!sections.length) throw new Error(t("err.noJson"));
  return { title: String(data.title || "").trim() || "Freelance Service Agreement", sections };
}

function parseExtras(raw) {
  const data = extractJson(raw);
  const levels = ["high", "medium", "low"];
  return {
    email: { subject: String(data.email?.subject || "").trim(), body: String(data.email?.body || "").trim() },
    summary: (Array.isArray(data.summary) ? data.summary : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 8),
    flags: (Array.isArray(data.flags) ? data.flags : [])
      .map((f) => ({
        level: levels.includes(f.level) ? f.level : "medium",
        section: SECTION_IDS.includes(f.section) ? f.section : null,
        issue: String(f.issue || "").trim(),
        fix: String(f.fix || "").trim(),
        done: false,
      }))
      .filter((f) => f.issue)
      .slice(0, 4),
  };
}

/* Sample answers so the page works in a normal browser. */
function demoAnswer(prompt) {
  const client = (prompt.match(/\nClient: ([^,\n]*)/) || [])[1] || "[CLIENT]";
  let out;
  if (/\nRewrite one section/.test(prompt)) {
    const heading = (prompt.match(/\nheading: (.*)/) || [])[1] || "Section";
    const body = prompt.split("\nbody:\n")[1]?.split("\n\nReturn exactly")[0] || "";
    out = { heading, body: body.split(". ").slice(0, 2).join(". ") };
  } else if (/write three things/.test(prompt)) {
    out = {
      email: { subject: `Contract for our project`, body: `Hi ${client},\n\nplease find the contract for our project attached. It covers the scope, the price and the timeline we discussed.\n\nCould you review and sign it? Happy to answer any questions.\n\nBest regards,\n[YOUR NAME]` },
      summary: ["What will be delivered and what is not included.", "The price and when it is paid.", "How many rounds of changes are included.", "Who owns the work and when."],
      flags: [{ level: "medium", section: "scope", issue: "There is no process for change requests.", fix: "Add that changes outside the scope are quoted in writing before work starts." }],
    };
  } else {
    out = {
      title: "Freelance Service Agreement",
      sections: SECTIONS.map(([id, what], i) => ({ id, heading: `${i + 1}. ${what.split(":")[0]}`, body: what.split(": ").slice(1).join(": ") || what })),
    };
  }
  return new Promise((r) => setTimeout(() => r(JSON.stringify(out)), 600));
}

/* --------------------------------------------------------- number safety */

const numbersIn = (s) => String(s).match(/\d+(?:[.,:/-]\d+)*/g) || [];

// Numbers from the old text that are missing from the new one.
function droppedNumbers(oldText, newText) {
  const have = new Set(numbersIn(newText));
  return [...new Set(numbersIn(oldText))].filter((n) => !have.has(n));
}

/* ------------------------------------------------------------- the check */

function localFlags(b, p) {
  const flags = [];
  const add = (id, level, vars = {}) => flags.push({ id, level, local: true, vars });
  if (!p.name || !p.country) add("noProfile", "medium");
  if (b.price === "" || b.price == null || Number(b.price) <= 0) add("noPrice", "high");
  if (Number(b.deposit) <= 0 && b.model !== "hourly") add("noDeposit", "medium");
  if (b.start && b.deadline && b.deadline < b.start) add("datesOrder", "high");
  if (b.scope.trim().length < 60) add("vagueScope", "medium");
  if (Number(b.revisions) > 5) add("manyRevisions", "low", { n: b.revisions });
  return flags;
}

const flagText = (f) => (f.local ? t(`flag.${f.id}`, f.vars) : f.issue);
const flagFix = (f) => (f.local ? t(`flag.${f.id}Fix`, f.vars) : f.fix);

/* ------------------------------------------------------------------ form */

function renderForm() {
  const ui = $("#ui-lang");
  for (const l of UI_LANGS) ui.add(new Option(l.label, l.id));
  const cur = $("#currency");
  for (const c of CURRENCIES) cur.add(new Option(c, c));
  const dl = $("#doc-lang");
  for (const l of DOC_LANGUAGES) dl.add(new Option(l, l));
  dl.value = DOC_LANG_FOR_UI[uiLang()] || "English";
  cur.value = { de: "EUR", zh: "CNY", ru: "RUB", hi: "INR" }[uiLang()] || "EUR";
  $("#start").value = new Date().toISOString().slice(0, 10);
}

function renderModelFields() {
  const hourly = $("#model").value === "hourly";
  $("#price-label").textContent = t(hourly ? "price.labelHourly" : "price.label");
  $("#milestones-field").hidden = $("#model").value !== "milestones";
}

function readBrief() {
  return {
    clientName: $("#client-name").value.trim(),
    clientCountry: $("#client-country").value.trim(),
    scope: $("#scope").value.trim(),
    price: $("#price").value.trim(),
    currency: $("#currency").value,
    model: $("#model").value,
    milestones: $("#milestones").value.trim(),
    deposit: $("#deposit").value === "" ? 0 : Number($("#deposit").value),
    revisions: $("#revisions").value === "" ? 0 : Number($("#revisions").value),
    start: $("#start").value,
    deadline: $("#deadline").value,
    ip: $("#ip").value,
    docLang: $("#doc-lang").value,
    tone: $("#tone").value,
  };
}

function applyBrief(b) {
  if (!b) return;
  const set = (id, v) => { if (v !== undefined && v !== null) $(id).value = v; };
  set("#client-name", b.clientName);
  set("#client-country", b.clientCountry);
  set("#scope", b.scope);
  set("#price", b.price);
  if (CURRENCIES.includes(b.currency)) set("#currency", b.currency);
  set("#model", b.model);
  set("#milestones", b.milestones);
  set("#deposit", b.deposit);
  set("#revisions", b.revisions);
  set("#start", b.start);
  set("#deadline", b.deadline);
  set("#ip", b.ip);
  if (DOC_LANGUAGES.includes(b.docLang)) set("#doc-lang", b.docLang);
  set("#tone", b.tone);
  renderModelFields();
}

function setStatus(key, vars = {}, isError = false) {
  state.status = key ? { key, vars, isError } : null;
  renderStatus();
}

function renderStatus() {
  const s = state.status;
  const el = $("#status");
  el.textContent = s ? t(s.key, s.vars) : "";
  el.classList.toggle("error", !!s?.isError);
}

/* --------------------------------------------------------------- profile */

function renderProfile() {
  const p = state.profile;
  const el = $("#profile-summary");
  const filled = p.name && p.country;
  el.textContent = filled ? [p.name, p.role, p.country].filter(Boolean).join(" · ") : t("profile.empty");
  el.classList.toggle("missing", !filled);
}

function openProfile() {
  const p = state.profile;
  $("#p-name").value = p.name;
  $("#p-role").value = p.role;
  $("#p-country").value = p.country;
  $("#p-email").value = p.email;
  $("#p-due").value = p.dueDays ?? 14;
  $("#p-late").value = p.lateFee ?? "";
  $("#profile-dialog").showModal();
  $("#p-name").focus();
}

async function saveProfile() {
  state.profile = {
    name: $("#p-name").value.trim(),
    role: $("#p-role").value.trim(),
    country: $("#p-country").value.trim(),
    email: $("#p-email").value.trim(),
    dueDays: $("#p-due").value === "" ? 14 : Number($("#p-due").value),
    lateFee: $("#p-late").value.trim(),
  };
  await save(KEYS.profile, state.profile);
  renderProfile();
  $("#profile-dialog").close();
  toast(t("toast.profileSaved"));
}

/* -------------------------------------------------------------- generate */

async function draft(e) {
  e.preventDefault();
  if (state.busy) return;
  const brief = readBrief();
  if (!brief.clientName) return setStatus("status.needClient", {}, true);
  if (!brief.scope) return setStatus("status.needScope", {}, true);

  const profile = { ...state.profile };
  state.busy = true;
  $("#go").disabled = true;
  setStatus("status.drafting");

  const already = localFlags(brief, profile).map((f) => {
    const was = uiLang();
    setUiLang("en");
    const text = flagText(f);
    setUiLang(was);
    return text;
  });

  const [contract, extras] = await Promise.allSettled([
    ask(CONTRACT_SYSTEM, contractPrompt(brief, profile), 4000).then(parseContract),
    ask(EXTRAS_SYSTEM, extrasPrompt(brief, profile, already), 1600).then(parseExtras),
  ]);

  state.busy = false;
  $("#go").disabled = false;

  if (contract.status === "rejected") {
    setStatus("status.failed", { reason: friendlyError(contract.reason) }, true);
    return;
  }

  const ex = extras.status === "fulfilled" ? extras.value : { email: { subject: "", body: "" }, summary: [], flags: [] };
  state.result = {
    id: `d${Date.now().toString(36)}`,
    at: Date.now(),
    brief,
    profile,
    title: contract.value.title,
    sections: contract.value.sections,
    email: ex.email,
    summary: ex.summary,
    flags: ex.flags,
    chat: [],
  };
  state.view = "contract";
  renderDoc({ stamp: true });
  // On a phone the contract sits below the form: bring it into view.
  if (matchMedia("(max-width: 760px)").matches) $(".room").scrollIntoView({ behavior: "smooth", block: "start" });

  if (extras.status === "rejected") setStatus("status.extrasFailed", { reason: friendlyError(extras.reason) }, true);
  else setStatus("status.done");

  state.history = [state.result, ...state.history.filter((h) => h.id !== state.result.id)].slice(0, 10);
  renderHistory();
  save(KEYS.history, state.history);
  save(KEYS.last, brief);
}

/* -------------------------------------------------------------- document */

function renderDoc(opts = {}) {
  const r = state.result;
  $("#empty").hidden = !!r;
  $("#doc-bar").hidden = !r;
  $("#check").hidden = !r;
  $("#assistant").hidden = !r;
  for (const v of document.querySelectorAll(".sheet")) v.hidden = !r || v.dataset.view !== state.view;
  if (!r) return;
  renderChat();

  for (const tb of document.querySelectorAll("#tabs .tab")) tb.setAttribute("aria-selected", String(tb.dataset.view === state.view));
  $("#copy-btn").textContent = t(`copy.${state.view}`);

  // Contract
  $("#doc-title").textContent = r.title;
  const date = new Date(r.at).toLocaleDateString(uiLang(), { year: "numeric", month: "long", day: "numeric" });
  $("#doc-meta").textContent = `${t("doc.between", { freelancer: r.profile.name || "[…]", client: r.brief.clientName })} · ${date}`;
  const box = $("#sections");
  box.innerHTML = "";
  r.sections.forEach((sec, i) => box.append(renderSection(sec, i)));
  renderSignatures();

  // Email and summary
  $("#email-subject").textContent = r.email.subject;
  $("#email-body").textContent = r.email.body;
  const ul = $("#summary");
  ul.innerHTML = "";
  r.summary.forEach((line, i) => {
    const li = document.createElement("li");
    li.contentEditable = "plaintext-only";
    li.textContent = line;
    li.addEventListener("input", () => { r.summary[i] = li.textContent; saveHistorySoon(); });
    ul.append(li);
  });

  renderFlags();

  if (opts.stamp) {
    const seal = $("#seal");
    seal.classList.remove("stamp");
    void seal.getBoundingClientRect();
    seal.classList.add("stamp");
  }
}

function renderSection(sec, i) {
  const r = state.result;
  const el = document.createElement("section");
  el.className = "section";
  el.dataset.id = sec.id;

  const h = document.createElement("h3");
  h.contentEditable = "plaintext-only";
  h.textContent = sec.heading;
  h.addEventListener("input", () => { r.sections[i].heading = h.textContent; saveHistorySoon(); });

  const body = document.createElement("div");
  body.className = "section-body";
  body.contentEditable = "plaintext-only";
  body.textContent = sec.body;
  body.addEventListener("input", () => { r.sections[i].body = body.innerText; saveHistorySoon(); });

  const tools = document.createElement("div");
  tools.className = "section-tools";
  tools.append(
    miniButton(t("sec.simpler"), () => rewriteSection(i, "simpler")),
    miniButton(t("sec.protect"), () => rewriteSection(i, "protect")),
  );

  el.append(h, body, tools);
  return el;
}

function renderSignatures() {
  const r = state.result;
  const box = $("#signatures");
  box.innerHTML = "";
  const party = (title, name) => {
    const d = document.createElement("div");
    d.className = "sig";
    const h = document.createElement("h4");
    h.textContent = title;
    d.append(h);
    for (const [label, value] of [[t("sig.name"), name], [t("sig.signature"), ""], [t("sig.date"), ""]]) {
      const line = document.createElement("div");
      line.className = "sig-line";
      const v = document.createElement("span");
      v.textContent = value;
      const l = document.createElement("span");
      l.textContent = label;
      line.append(v, l);
      d.append(line);
    }
    return d;
  };
  box.append(party(t("sig.freelancer"), r.profile.name), party(t("sig.client"), r.brief.clientName));
}

function miniButton(label, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "mini";
  b.textContent = label;
  b.onclick = fn;
  return b;
}

function renderFlags() {
  const r = state.result;
  const ul = $("#flags");
  ul.innerHTML = "";
  const order = { high: 0, medium: 1, low: 2 };
  const all = [...localFlags(r.brief, r.profile), ...r.flags.map((f, i) => ({ ...f, aiIndex: i }))]
    .sort((a, b) => order[a.level] - order[b.level]);
  if (!all.length) {
    const li = document.createElement("li");
    li.className = "check-none";
    li.textContent = t("check.none");
    ul.append(li);
    return;
  }
  for (const f of all) {
    const li = document.createElement("li");
    li.className = "flag" + (f.done ? " done" : "");
    li.dataset.level = f.level;
    const lvl = document.createElement("span");
    lvl.className = "flag-level";
    lvl.textContent = f.done ? t("check.fixed") : t(`level.${f.level}`);
    const issue = document.createElement("p");
    issue.textContent = flagText(f);
    const fix = document.createElement("p");
    fix.className = "fix";
    fix.textContent = flagFix(f);
    li.append(lvl, issue, fix);
    const target = !f.local && !f.done && f.section ? r.sections.findIndex((s) => s.id === f.section) : -1;
    if (target >= 0) li.append(miniButton(t("check.fix"), () => rewriteSection(target, "fix", f.aiIndex, li)));
    ul.append(li);
  }
}

/* -------------------------------------------------------------- rewrites */

async function rewriteSection(i, kind, aiIndex, flagEl) {
  const r = state.result;
  const sec = r.sections[i];
  const el = document.querySelectorAll("#sections .section")[i];
  if (!el || el.classList.contains("busy")) return;
  const flag = aiIndex != null ? r.flags[aiIndex] : null;
  const buttons = [...el.querySelectorAll("button"), ...(flagEl ? flagEl.querySelectorAll("button") : [])];

  if (state.view !== "contract") { state.view = "contract"; renderDoc(); return rewriteSection(i, kind, aiIndex); }
  el.classList.add("busy");
  buttons.forEach((b) => (b.disabled = true));
  el.scrollIntoView({ behavior: "smooth", block: "center" });

  try {
    let next = null;
    let dropped = null;
    for (let attempt = 0; attempt < 2 && !next; attempt++) {
      const data = extractJson(await ask(REWRITE_SYSTEM, rewritePrompt(r, sec, kind, flag, dropped), 1200));
      const cand = { heading: String(data.heading || sec.heading).trim(), body: String(data.body || "").trim() };
      if (!cand.body) continue;
      // A fix may change a number on purpose; the other rewrites may not.
      dropped = kind === "fix" ? [] : droppedNumbers(sec.body, cand.body);
      if (!dropped.length) next = cand;
    }
    if (!next) throw new Error(t("err.changedNumbers"));

    r.sections[i] = { ...sec, heading: next.heading, body: next.body };
    if (flag) flag.done = true;
    save(KEYS.history, state.history);
    renderDoc();
    const fresh = document.querySelectorAll("#sections .section")[i];
    fresh?.classList.add("flash");
    toast(t(flag ? "toast.fixed" : "toast.sectionUpdated"));
  } catch (err) {
    el.classList.remove("busy");
    buttons.forEach((b) => (b.disabled = false));
    const action = flag ? t("action.fix") : t(kind === "simpler" ? "sec.simpler" : "sec.protect");
    toast(t("toast.rewriteFailed", { action, reason: friendlyError(err) }));
  }
}

/* ------------------------------------------------------------ chat edits */
//
// The user revises the contract in their own words. Requests go to an Anna
// agent session (anna.agent.session), which keeps the conversation on the
// server; if the host has no agent session for this app, the same prompt goes
// to anna.llm.complete with the recent turns included. Every message carries
// the latest contract, so hand edits are never lost. The model answers with
// section changes; the app applies them, renumbers, highlights what changed,
// reports changed numbers and keeps an undo snapshot of the last change.

const CHAT_SYSTEM = `You are the contract editor inside the DealSeal app. The user is a freelancer revising a contract the app drafted. You are not a lawyer and never claim to be.
${NO_INVENT}
You have no tools: do not try to read or write files or browse. Work only from the deal facts and the contract in each message.
For every request, make the smallest set of section changes that does what the user asked. Keep everything else word for word and keep the contract's language. If a request is unclear, or would make the contract unfair or unlawful, ask a short question or explain instead of changing anything.
Answer with JSON only, no markdown fences:
{"reply":"one or two sentences to the user","changes":[{"op":"update","id":"<section id>","heading":"...","body":"..."},{"op":"add","after":"<section id, or start>","heading":"...","body":"..."},{"op":"remove","id":"<section id>"}],"title":"only if the title should change","email":{"subject":"...","body":"..."}}
Use "changes": [] when the contract should not change. Leave out "title" and "email" unless they should change. Body text: paragraphs separated by a blank line, lists as lines starting with "- ".`;

const chat = { busy: false, cancelled: false, mode: "agent", session: null, runId: null };
const agentSessions = new Map(); // contract id → AgentSession

class RunError extends Error {
  constructor(message, extra = {}) { super(message); Object.assign(this, extra); }
}

function contractSnapshot(r) {
  return JSON.stringify({
    title: r.title,
    sections: r.sections.map((s) => ({ id: s.id, heading: s.heading, body: s.body })),
    email: r.email,
  });
}

function recentTurns(r) {
  return (r.chat || []).slice(-8, -1).map((m) => `${m.role === "user" ? "User" : "You"}: ${m.text}`).join("\n");
}

function chatPrompt(r, request, withRecent) {
  const recent = withRecent ? recentTurns(r) : "";
  return `DEAL FACTS:
${dealFacts(r.brief, r.profile)}

CURRENT CONTRACT (the user may have edited it by hand; this is the latest version):
${contractSnapshot(r)}
${recent ? `\nEARLIER IN THIS CONVERSATION:\n${recent}\n` : ""}
Contract language: ${r.brief.docLang}. Write "reply" in ${UI_LANG_NAME[uiLang()]}.

USER REQUEST:
${request}`;
}

async function agentSession(r, fresh) {
  if (!fresh && agentSessions.has(r.id)) return agentSessions.get(r.id);
  const s = await state.anna.agent.session({ submode: "auto", system_prompt: CHAT_SYSTEM });
  agentSessions.set(r.id, s);
  return s;
}

// Read one run's stream into text; every terminal state is handled.
async function runAgent(session, content) {
  let text = "";
  chat.session = session;
  for await (const f of session.run({ content })) {
    if (f.run_id) chat.runId = f.run_id;
    if (f.event === "sse") {
      if (f.error) throw new RunError(f.error, { code: f.error_type || "run_error" });
      const d = f.choices?.[0]?.delta;
      if (typeof d?.content === "string") text += d.content;
      else if (d?.task_cancelled) throw new RunError("cancelled", { cancelled: true });
    } else if (f.event === "error") {
      throw new RunError(f.message || "run error", { code: f.code || "run_error" });
    } else if (f.event === "end") {
      break;
    }
  }
  return text;
}

async function askChat(r, request) {
  if (!state.anna) return demoChat(r, request);
  if (chat.mode === "agent" && state.anna.agent?.session) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let session;
      try {
        session = await agentSession(r, attempt > 0);
      } catch (e) {
        console.info("[dealseal] no agent session, using llm.complete:", e?.code || e?.message);
        chat.mode = "llm";
        break;
      }
      try {
        const text = await runAgent(session, `${chatPrompt(r, request, false)}\n\nAnswer with the JSON described in your instructions.`);
        if (text.trim()) return text;
        throw new RunError(t("assistant.empty"), { code: "empty_completion" });
      } catch (e) {
        if (e.cancelled || chat.cancelled) throw new RunError("cancelled", { cancelled: true });
        // An expired session is replaced once; an empty answer is retried once.
        const code = `${e.code || ""}`;
        if (attempt === 0 && /session_(revoked|expired|not_found)|expired|not_found|empty_completion/i.test(code)) {
          if (!/empty_completion/i.test(code)) agentSessions.delete(r.id);
          continue;
        }
        // The agent is not available for this app or user: stop trying it.
        if (/not_granted|permission|denied|disabled|unavailable|no_agent|queue_timeout/i.test(code)) chat.mode = "llm";
        console.info("[dealseal] agent session failed, answering with llm.complete:", code || e.message);
        break;
      }
    }
    if (chat.cancelled) throw new RunError("cancelled", { cancelled: true });
  }
  const res = await state.anna.llm.complete({
    systemPrompt: CHAT_SYSTEM,
    messages: [{ role: "user", content: { type: "text", text: chatPrompt(r, request, true) } }],
    maxTokens: 4000,
    temperature: 0.3,
  });
  return completionText(res);
}

function parseChat(raw) {
  let data;
  try {
    data = extractJson(raw);
  } catch {
    // Not JSON: show it as a plain answer and change nothing.
    return { reply: String(raw || "").trim().slice(0, 800), changes: [] };
  }
  return {
    reply: String(data.reply || "").trim(),
    changes: (Array.isArray(data.changes) ? data.changes : []).filter((c) => c && ["update", "add", "remove"].includes(c.op)),
    title: typeof data.title === "string" ? data.title.trim() : "",
    email: data.email && typeof data.email === "object" ? data.email : null,
  };
}

function renumber(sections) {
  sections.forEach((s, i) => {
    if (/^\s*\d+\s*[.)]\s*/.test(s.heading)) s.heading = s.heading.replace(/^\s*\d+\s*[.)]\s*/, `${i + 1}. `);
  });
}

function applyChanges(r, parsed) {
  const before = { title: r.title, sections: r.sections.map((s) => ({ ...s })), email: { ...r.email } };
  const sections = r.sections.map((s) => ({ ...s }));
  const changed = [], added = [], removed = [];
  for (const c of parsed.changes) {
    if (c.op === "update") {
      const i = sections.findIndex((s) => s.id === c.id);
      if (i < 0) continue;
      const body = String(c.body ?? "").trim() || sections[i].body;
      const heading = String(c.heading ?? "").trim() || sections[i].heading;
      if (body === sections[i].body && heading === sections[i].heading) continue;
      sections[i] = { ...sections[i], heading, body };
      changed.push(sections[i].id);
    } else if (c.op === "add") {
      const heading = String(c.heading || "").trim();
      const body = String(c.body || "").trim();
      if (!heading || !body) continue;
      const id = `added-${Date.now().toString(36)}-${added.length}`;
      let at = c.after === "start" ? 0 : sections.findIndex((s) => s.id === c.after) + 1;
      if (at <= 0 && c.after !== "start") at = Math.max(0, sections.length - (sections.at(-1)?.id === "general" ? 1 : 0));
      sections.splice(at, 0, { id, heading, body });
      added.push(id);
    } else if (c.op === "remove") {
      const i = sections.findIndex((s) => s.id === c.id);
      if (i < 0 || sections.length <= 1) continue;
      removed.push(sections[i].heading.replace(/^\s*\d+\s*[.)]\s*/, ""));
      sections.splice(i, 1);
    }
  }
  renumber(sections);

  let titleChanged = false;
  if (parsed.title && parsed.title !== r.title) { r.title = parsed.title; titleChanged = true; }
  let emailChanged = false;
  if (parsed.email && (parsed.email.subject || parsed.email.body)) {
    const e = { subject: String(parsed.email.subject ?? r.email.subject).trim(), body: String(parsed.email.body ?? r.email.body).trim() };
    if (e.subject !== r.email.subject || e.body !== r.email.body) { r.email = e; emailChanged = true; }
  }

  const oldNums = new Set(numbersIn(before.sections.map((s) => s.body).join("\n")));
  const newNums = new Set(numbersIn(sections.map((s) => s.body).join("\n")));
  const numbers = { added: [...newNums].filter((n) => !oldNums.has(n)), removed: [...oldNums].filter((n) => !newNums.has(n)) };

  r.sections = sections;
  const headingOf = (id) => sections.find((s) => s.id === id)?.heading.replace(/^\s*\d+\s*[.)]\s*/, "") || id;
  return {
    before,
    ids: [...changed, ...added],
    summary: { changed: changed.map(headingOf), added: added.map(headingOf), removed, titleChanged, emailChanged, numbers },
    any: changed.length + added.length + removed.length > 0 || titleChanged || emailChanged,
  };
}

async function sendChat(text) {
  const r = state.result;
  const request = String(text || "").trim();
  if (!r || chat.busy || !request) return;
  r.chat = r.chat || [];
  r.chat.push({ role: "user", text: request });
  chat.busy = true;
  chat.cancelled = false;
  chat.runId = null;
  $("#chat-input").value = "";
  setChatBusy(true);
  renderChat();

  let flashIds = [];
  try {
    const raw = await askChat(r, request);
    if (chat.cancelled) throw new RunError("cancelled", { cancelled: true });
    const parsed = parseChat(raw);
    const applied = parsed.changes.length || parsed.title || parsed.email ? applyChanges(r, parsed) : null;
    const msg = { role: "ai", text: parsed.reply || (applied?.any ? "" : t("assistant.none")) };
    if (applied?.any) {
      msg.summary = applied.summary;
      msg.undo = applied.before;
      flashIds = applied.ids;
    } else if (parsed.reply && parsed.changes.length) {
      msg.summary = { none: true };
    }
    for (const m of r.chat) delete m.undo; // only the latest change can be undone
    r.chat.push(msg);
  } catch (e) {
    r.chat.push({ role: "ai", error: !e.cancelled, text: e.cancelled ? t("assistant.cancelled") : t("assistant.error", { reason: friendlyError(e) }) });
  } finally {
    chat.busy = false;
    setChatBusy(false);
    renderDoc();
    for (const id of flashIds) document.querySelector(`#sections .section[data-id="${CSS.escape(id)}"]`)?.classList.add("flash");
    if (flashIds.length) document.querySelector(`#sections .section[data-id="${CSS.escape(flashIds[0])}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    save(KEYS.history, state.history);
  }
}

function undoChat(msg) {
  const r = state.result;
  if (!msg.undo) return;
  r.title = msg.undo.title;
  r.sections = msg.undo.sections;
  r.email = msg.undo.email;
  delete msg.undo;
  msg.undone = true;
  r.chat.push({ role: "ai", text: t("assistant.undone") });
  renderDoc();
  save(KEYS.history, state.history);
}

function stopChat() {
  if (!chat.busy) return;
  chat.cancelled = true;
  if (chat.session && chat.runId) chat.session.cancel(chat.runId).catch(() => {});
}

function setChatBusy(busy) {
  $("#chat-send").hidden = busy;
  $("#chat-stop").hidden = !busy;
}

function renderChat() {
  const r = state.result;
  const log = $("#chat-log");
  log.innerHTML = "";
  const msgs = r?.chat || [];
  $("#suggestions").hidden = msgs.length > 0;
  for (const m of msgs) {
    const li = document.createElement("li");
    li.className = `msg ${m.role}${m.error ? " error" : ""}`;
    const who = document.createElement("span");
    who.className = "sr-only";
    who.textContent = `${t(m.role === "user" ? "assistant.you" : "assistant.ai")}: `;
    li.append(who);
    if (m.text) {
      const p = document.createElement("p");
      p.textContent = m.text;
      li.append(p);
    }
    const s = m.summary;
    if (s && !s.none) {
      const lines = [];
      if (s.changed?.length) lines.push(t("assistant.changed", { list: s.changed.join(", ") }));
      if (s.added?.length) lines.push(t("assistant.added", { list: s.added.join(", ") }));
      if (s.removed?.length) lines.push(t("assistant.removed", { list: s.removed.join(", ") }));
      if (s.titleChanged) lines.push(t("assistant.titleChanged"));
      if (s.emailChanged) lines.push(t("assistant.emailChanged"));
      const ul = document.createElement("ul");
      ul.className = "msg-changes";
      for (const line of lines) {
        const item = document.createElement("li");
        item.textContent = line;
        ul.append(item);
      }
      if (s.numbers && (s.numbers.added.length || s.numbers.removed.length)) {
        const item = document.createElement("li");
        item.className = "numbers";
        item.textContent = t("assistant.numbers", { added: s.numbers.added.join(", ") || "–", removed: s.numbers.removed.join(", ") || "–" });
        ul.append(item);
      }
      li.append(ul);
      if (m.undo) li.append(miniButton(t("assistant.undo"), () => undoChat(m)));
    }
    log.append(li);
  }
  if (chat.busy) {
    const li = document.createElement("li");
    li.className = "msg ai working";
    li.textContent = t("assistant.working");
    log.append(li);
  }
  log.scrollTop = log.scrollHeight;
}

/* Preview mode: a tiny stand-in editor so the chat can be tried outside Anna. */
function demoChat(r, request) {
  const pay = r.sections.find((s) => s.id === "payment");
  const out = { reply: "Done. I updated the contract.", changes: [] };
  if (/\d+\s*%/.test(request) && pay) {
    const pct = request.match(/(\d+)\s*%/)[1];
    out.changes.push({ op: "update", id: "payment", heading: pay.heading, body: pay.body.replace(/\d+\s*%/, `${pct}%`) });
  } else {
    out.changes.push({ op: "add", after: r.sections.at(-2)?.id || "start", heading: "99. Additional terms", body: `[${request}]` });
  }
  return new Promise((res) => setTimeout(() => res(JSON.stringify(out)), 500));
}

/* ------------------------------------------------------------------ copy */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function bodyToHtml(body) {
  return body.split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
      return `<ul>${lines.map((l) => `<li>${esc(l.replace(/^\s*[-•]\s+/, ""))}</li>`).join("")}</ul>`;
    }
    return `<p>${lines.map(esc).join("<br>")}</p>`;
  }).join("");
}

function contractExport() {
  const r = state.result;
  const meta = $("#doc-meta").textContent;
  const sig = (title, name) => [title, `${t("sig.name")}: ${name || ""}`, `${t("sig.signature")}: ____________________`, `${t("sig.date")}: ____________________`].join("\n");
  const plain = [
    r.title, meta, "",
    ...r.sections.flatMap((s) => [s.heading, s.body, ""]),
    sig(t("sig.freelancer"), r.profile.name), "",
    sig(t("sig.client"), r.brief.clientName),
  ].join("\n");
  const sigHtml = (title, name) => `<td style="vertical-align:top;padding-right:40px"><p><strong>${esc(title)}</strong></p><p>${esc(t("sig.name"))}: ${esc(name || "")}</p><p>${esc(t("sig.signature"))}: ____________________</p><p>${esc(t("sig.date"))}: ____________________</p></td>`;
  const html = `<h1>${esc(r.title)}</h1><p><em>${esc(meta)}</em></p>${r.sections.map((s) => `<h2>${esc(s.heading)}</h2>${bodyToHtml(s.body)}`).join("")}<table><tr>${sigHtml(t("sig.freelancer"), r.profile.name)}${sigHtml(t("sig.client"), r.brief.clientName)}</tr></table>`;
  return { plain, html };
}

async function copyCurrent() {
  const r = state.result;
  if (!r) return;
  if (state.view === "contract") {
    const { plain, html } = contractExport();
    try {
      if (!window.ClipboardItem || !navigator.clipboard?.write) throw new Error("no rich clipboard");
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      })]);
      toast(t("toast.copiedRich"));
    } catch {
      await copyPlain(plain);
    }
  } else if (state.view === "email") {
    await copyPlain(`${r.email.subject}\n\n${r.email.body}`);
  } else {
    await copyPlain(r.summary.map((l) => `- ${l}`).join("\n"));
  }
}

async function copyPlain(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast(t("toast.copied"));
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

/* --------------------------------------------------------------- history */

function renderHistory() {
  const ul = $("#history");
  ul.innerHTML = "";
  for (const h of state.history) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.append(document.createTextNode(h.brief.clientName), document.createElement("br"));
    const small = document.createElement("small");
    small.textContent = `${h.title} · ${new Date(h.at).toLocaleDateString(uiLang())}`;
    b.append(small);
    b.onclick = () => {
      state.result = h;
      state.view = "contract";
      applyBrief(h.brief);
      renderDoc();
      $(".room").scrollTo({ top: 0, behavior: "smooth" });
    };
    li.append(b);
    ul.append(li);
  }
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  renderForm();
  applyStaticText();
  $("#ui-lang").value = uiLang();
  applyTheme($("#theme").dataset.theme || "auto");

  $("#theme").addEventListener("click", () => save(KEYS.theme, applyTheme(THEMES[$("#theme").dataset.theme || "auto"].next)));
  $("#ui-lang").addEventListener("change", (e) => changeUiLang(e.target.value));
  $("#model").addEventListener("change", renderModelFields);
  $("#brief").addEventListener("submit", draft);
  $("#edit-profile").addEventListener("click", openProfile);
  $("#profile-form").addEventListener("submit", (e) => { e.preventDefault(); saveProfile(); });
  $("#p-cancel").addEventListener("click", () => $("#profile-dialog").close());
  $("#copy-btn").addEventListener("click", copyCurrent);
  $("#chat-form").addEventListener("submit", (e) => { e.preventDefault(); sendChat($("#chat-input").value); });
  $("#chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat($("#chat-input").value); }
  });
  $("#chat-stop").addEventListener("click", stopChat);
  for (const b of document.querySelectorAll("#suggestions .sugg")) b.addEventListener("click", () => sendChat(b.textContent));
  for (const tb of document.querySelectorAll("#tabs .tab")) {
    tb.addEventListener("click", () => { state.view = tb.dataset.view; renderDoc(); });
  }
  $("#doc-title").addEventListener("input", (e) => { if (state.result) { state.result.title = e.target.textContent; saveHistorySoon(); } });
  $("#email-subject").addEventListener("input", (e) => { if (state.result) { state.result.email.subject = e.target.textContent; saveHistorySoon(); } });
  $("#email-body").addEventListener("input", (e) => { if (state.result) { state.result.email.body = e.target.innerText; saveHistorySoon(); } });

  await connect();
  applyTheme(await load(KEYS.theme, $("#theme").dataset.theme || "auto"));
  const savedLang = await load(KEYS.uiLang, null);
  if (savedLang && savedLang !== uiLang()) {
    setUiLang(savedLang);
    try { localStorage.setItem(KEYS.uiLang, uiLang()); } catch {}
  }

  state.profile = { ...DEFAULT_PROFILE, ...((await load(KEYS.profile, null)) || {}) };
  state.history = (await load(KEYS.history, [])) || [];
  const last = await load(KEYS.last, null);
  if (last) applyBrief({ ...last, start: last.start || $("#start").value });
  else $("#doc-lang").value = DOC_LANG_FOR_UI[uiLang()] || "English";

  if (!state.anna) setStatus("status.preview");
  renderUi();
}

boot();
