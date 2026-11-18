/*
 * YYC Job Control – chatbot widget (MOCK version, no backend, no Firebase).
 * Usage:  <link rel="stylesheet" href="chatbot.css">
 *         <script src="chatbot.js" defer></script>
 * Optional: window.YYCChat.init({ title: "...", getReply: async (text) => "..." })
 *
 * To connect a real AI later, pass your own getReply(text) that calls a Cloud Function.
 * NEVER put an AI API key in this file.
 */
(function () {
  "use strict";

  const SUGGESTIONS = ["Which jobs are delayed?", "How do I reassign a job?", "What are the job stages?", "Show my workload"];

  // ---- MOCK replies: replace with a real backend call later ----
  const MOCK_RULES = [
    { match: /delay|late|overdue/i, reply: "**3 jobs** are past their target date:\n- ABC Sdn Bhd (Audit) {{delayed}} 5 days late\n- XYZ Bhd (Tax) {{delayed}} 2 days late\n- Lim & Co (Tax) {{atrisk}} 1 day late\n_Mock data_" },
    { match: /reassign|transfer|handover/i, reply: "To reassign a job:\n- Open the job from your **team list**\n- Choose a new preparer\n- Confirm\nOnly managers can do this." },
    { match: /stage|workflow|status/i, reply: "Jobs move through these stages:\n- Preparation\n- Review\n- Amendments\n- Draft to client\n- Client review\n- Submission" },
    { match: /workload|my jobs|assigned/i, reply: "You currently hold **12 jobs**:\n- 7 in Preparation {{ontrack}}\n- 3 in Review {{atrisk}}\n- 2 in Amendments {{delayed}}\n_Mock data_" },
    { match: /thank|thanks|thx|tq/i, reply: "You're welcome! Let me know if you need anything else." },
    { match: /bye|goodbye|see you|cya/i, reply: "Goodbye! Have a great day." },
    { match: /who are you|what can you do|help/i, reply: "I'm the YYC assistant (demo). I can answer questions about:\n- **Delayed jobs**\n- **Reassigning** a job\n- **Job stages**\n- Your **workload**" },
    { match: /hello|hi\b|hey/i, reply: "Hi! I'm the YYC assistant. Ask me about jobs, stages or workload." },
  ];
  const FALLBACK = "I'm only a demo right now, so I can't answer that yet. Try one of the suggestions below the chat.";

  async function defaultGetReply(text) {
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 600)); // fake thinking time
    const rule = MOCK_RULES.find((x) => x.match.test(text));
    return rule ? rule.reply : FALLBACK;
  }

  const ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  const ICON_BOT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V5M9 13h.01M15 13h.01"/></svg>';

  // ---- Formatting: safe mini-markdown (escape first, then add tags) ----
  const PILLS = { delayed: "Delayed", atrisk: "At risk", ontrack: "On track", done: "Done" };
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function inline(s) {
    return escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/(^|\s)_(.+?)_(?=\s|$|[.,!?])/g, "$1<em>$2</em>")
      .replace(/\{\{(delayed|atrisk|ontrack|done)\}\}/g, function (_, k) {
        return '<span class="yyc-chat__pill yyc-chat__pill--' + k + '">' + PILLS[k] + "</span>";
      });
  }
  function formatMessage(text) {
    const out = [];
    let list = null;
    String(text).split("\n").forEach(function (line) {
      const m = line.match(/^\s*[-•]\s+(.*)$/);
      if (m) {
        if (!list) { list = []; }
        list.push("<li>" + inline(m[1]) + "</li>");
      } else {
        if (list) { out.push("<ul>" + list.join("") + "</ul>"); list = null; }
        if (line.trim() !== "") out.push("<p>" + inline(line) + "</p>");
      }
    });
    if (list) out.push("<ul>" + list.join("") + "</ul>");
    return out.join("");
  }

  // ---- Saved history (browser localStorage; wrapped in try/catch) ----
  const STORE_KEY = "yycChat.history.v1";
  const MAX_SAVED = 60;
  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(function (m) { return m && typeof m.text === "string" && (m.who === "user" || m.who === "bot"); }) : [];
    } catch (e) { return []; }
  }
  function saveHistory(arr) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(arr.slice(-MAX_SAVED))); } catch (e) { /* storage unavailable: ignore */ }
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function timeOf(ts) {
    return new Date(ts || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function init(options) {
    if (document.querySelector(".yyc-chat")) return; // already mounted
    const opts = Object.assign({ title: "YYC Assistant", subtitle: "demo mode", getReply: defaultGetReply }, options || {});

    const root = el("div", "yyc-chat");
    const launcher = el("button", "yyc-chat__launcher", ICON_CHAT);
    launcher.type = "button";
    launcher.setAttribute("aria-label", "Open chat assistant");

    const panel = el("section", "yyc-chat__panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", opts.title);

    const header = el("div", "yyc-chat__header");
    const avatar = el("div", "yyc-chat__avatar", ICON_BOT);
    const titles = el("div");
    const title = el("div", "yyc-chat__title"); title.textContent = opts.title;
    const sub = el("div", "yyc-chat__sub"); sub.textContent = opts.subtitle;
    titles.append(title, sub);
    const closeBtn = el("button", "yyc-chat__close", "&times;");
    closeBtn.type = "button"; closeBtn.setAttribute("aria-label", "Close chat");
    const clearBtn = el("button", "yyc-chat__clear", "Clear");
    clearBtn.type = "button"; clearBtn.title = "Clear conversation"; clearBtn.setAttribute("aria-label", "Clear conversation");
    header.append(avatar, titles, clearBtn, closeBtn);

    const messages = el("div", "yyc-chat__messages");
    messages.setAttribute("aria-live", "polite");
    const chips = el("div", "yyc-chat__chips");

    const form = el("form", "yyc-chat__form");
    const input = el("input", "yyc-chat__input");
    input.type = "text"; input.placeholder = "Ask about jobs, stages, workload…"; input.autocomplete = "off";
    input.setAttribute("aria-label", "Message");
    const send = el("button", "yyc-chat__send", "Send");
    send.type = "submit";
    form.append(input, send);
    const note = el("div", "yyc-chat__note"); note.textContent = "Demo responses – not real job data.";

    panel.append(header, messages, chips, form, note);
    root.append(panel, launcher);
    document.body.appendChild(root);

    let history = loadHistory();

    function addMessage(text, who, ts, skipSave) {
      ts = ts || Date.now();
      const m = el("div", "yyc-chat__msg yyc-chat__msg--" + who);
      const body = el("div", "yyc-chat__body");
      if (who === "bot") body.innerHTML = formatMessage(text); // formatMessage escapes HTML first
      else body.textContent = text;
      const t = el("div", "yyc-chat__time"); t.textContent = timeOf(ts);
      m.append(body, t);
      messages.appendChild(m);
      messages.scrollTop = messages.scrollHeight;
      if (!skipSave) { history.push({ who: who, text: text, ts: ts }); saveHistory(history); }
      return m;
    }
    function addTyping() {
      const m = el("div", "yyc-chat__msg yyc-chat__msg--bot", '<div class="yyc-chat__typing"><span></span><span></span><span></span></div>');
      messages.appendChild(m);
      messages.scrollTop = messages.scrollHeight;
      return m;
    }

    async function handle(text) {
      text = text.trim();
      if (!text) return;
      addMessage(text, "user");
      input.value = ""; send.disabled = true; input.disabled = true;
      const typing = addTyping();
      let reply;
      try { reply = await opts.getReply(text); }
      catch (err) { reply = "Sorry, something went wrong. Please try again."; }
      typing.remove();
      addMessage(reply, "bot");
      send.disabled = false; input.disabled = false; input.focus();
    }

    SUGGESTIONS.forEach((s) => {
      const c = el("button", "yyc-chat__chip"); c.type = "button"; c.textContent = s;
      c.addEventListener("click", () => handle(s));
      chips.appendChild(c);
    });

    function setOpen(open) {
      root.classList.toggle("is-open", open);
      launcher.setAttribute("aria-label", open ? "Close chat assistant" : "Open chat assistant");
      if (open) { messages.scrollTop = messages.scrollHeight; input.focus(); }
    }
    launcher.addEventListener("click", () => setOpen(!root.classList.contains("is-open")));
    closeBtn.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
    form.addEventListener("submit", (e) => { e.preventDefault(); handle(input.value); });

    const GREETING = "Hi! I'm the YYC assistant (demo). What would you like to know?";
    if (history.length) history.forEach(function (h) { addMessage(h.text, h.who, h.ts, true); });
    else addMessage(GREETING, "bot");

    clearBtn.addEventListener("click", function () {
      history = []; saveHistory(history);
      messages.innerHTML = "";
      addMessage(GREETING, "bot");
    });
  }

  window.YYCChat = { init: init };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => init());
  else init();
})();
