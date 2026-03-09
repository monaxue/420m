/**
 * Quarto RevealJS Poll Extension v2
 * ─────────────────────────────────────────────────────────────────
 * Features:
 *  • :::poll:::          — multiple-choice poll
 *  • :::freeresponse:::  — free-text answer with AI grading
 *  • Countdown timer (admin sets beforehand, adjustable live)
 *  • Supabase Postgres + Realtime backend
 *  • Admin: password prompt, session-persisted
 *  • Results shown only after poll closes
 *  • AI (Claude) grades free responses: % correct + mistake taxonomy
 * ─────────────────────────────────────────────────────────────────
 *
 * Quarto syntax:
 *
 *   ::: poll
 *   **Which framework do you prefer?**
 *   - React
 *   - Vue
 *   - Svelte
 *   :::
 *
 *   ::: freeresponse
 *   **What is the capital of France?**
 *   [answer: Paris]
 *   :::
 *
 *   The [answer: ...] line is stripped from audience view automatically.
 *   Set per-poll timer via data-timer="30" attribute (seconds).
 *   Set global default via window.POLL_DEFAULT_TIMER = 60.
 *   Set 0 for no timer.
 */

window.RevealPoll = {
  id: "RevealPoll",
  init: async function (deck) {

    // ─── CONFIG ──────────────────────────────────────────────────────────────
    const SUPABASE_URL  = window.POLL_SUPABASE_URL  || "";
    const SUPABASE_ANON = window.POLL_SUPABASE_ANON || "";
    const ADMIN_PASS    = window.POLL_ADMIN_PASSWORD || "admin";
    const CLAUDE_KEY    = window.POLL_CLAUDE_API_KEY || "";
    const DEFAULT_TIMER = parseInt(window.POLL_DEFAULT_TIMER ?? "60", 10);

    if (!SUPABASE_URL || !SUPABASE_ANON) {
      console.warn("[Poll] Missing Supabase credentials. Set window.POLL_SUPABASE_URL and window.POLL_SUPABASE_ANON.");
    }

    // ─── SUPABASE CLIENT ─────────────────────────────────────────────────────
    const sb = {
      h: {
        "apikey": SUPABASE_ANON,
        "Authorization": `Bearer ${SUPABASE_ANON}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      async upsert(table, data) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
          method: "POST",
          headers: { ...this.h, "Prefer": "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify(data)
        });
        return r.json();
      },
      async select(table, filter = "") {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, { headers: this.h });
        return r.json();
      },
      async update(table, filter, data) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
          method: "PATCH",
          headers: this.h,
          body: JSON.stringify(data)
        });
        return r.json();
      },
      realtime(table, cb) {
        const wsUrl = SUPABASE_URL.replace(/^https/, "wss").replace(/^http(?!s)/, "ws");
        const ws = new WebSocket(`${wsUrl}/realtime/v1/websocket?apikey=${SUPABASE_ANON}&vsn=1.0.0`);
        ws.onopen = () => ws.send(JSON.stringify({
          topic: `realtime:public:${table}`, event: "phx_join", payload: {}, ref: null
        }));
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (["INSERT", "UPDATE", "DELETE"].includes(msg.event)) {
            cb(msg.event, msg.payload?.record);
          }
        };
        ws.onerror = e => console.warn("[Poll] WebSocket error", e);
        return ws;
      }
    };

    // ─── STATE ───────────────────────────────────────────────────────────────
    let isAdmin  = false;
    let userName = null;
    const activeSockets = {};
    const activeTimers  = {};

    // ─── MODAL HELPERS ────────────────────────────────────────────────────────
    function makeOverlay(innerHtml) {
      const ov = document.createElement("div");
      ov.className = "poll-modal-overlay";
      ov.innerHTML = `<div class="poll-modal">${innerHtml}</div>`;
      document.body.appendChild(ov);
      requestAnimationFrame(() => ov.classList.add("visible"));
      return ov;
    }
    function closeOverlay(ov) {
      ov.classList.remove("visible");
      setTimeout(() => ov.remove(), 300);
    }

    // ─── ADMIN AUTH ──────────────────────────────────────────────────────────
    function checkAdminSession() {
      return sessionStorage.getItem("poll_admin") === "1";
    }

    function promptAdmin() {
      return new Promise(resolve => {
        const ov = makeOverlay(`
          <div class="poll-modal-icon">🔐</div>
          <h3>Presenter Access</h3>
          <p>Enter your presenter password</p>
          <input type="password" id="poll-admin-pw" placeholder="Password" autocomplete="off"/>
          <div class="poll-modal-error" id="poll-admin-err"></div>
          <div class="poll-modal-actions">
            <button class="poll-btn poll-btn-ghost" id="poll-m-cancel">Cancel</button>
            <button class="poll-btn poll-btn-primary" id="poll-m-ok">Enter</button>
          </div>`);

        const input = ov.querySelector("#poll-admin-pw");
        const error = ov.querySelector("#poll-admin-err");
        input.focus();

        function submit() {
          if (input.value === ADMIN_PASS) {
            sessionStorage.setItem("poll_admin", "1");
            closeOverlay(ov);
            resolve(true);
          } else {
            error.textContent = "Incorrect password";
            input.value = "";
            input.classList.add("shake");
            setTimeout(() => input.classList.remove("shake"), 500);
          }
        }
        ov.querySelector("#poll-m-ok").onclick = submit;
        ov.querySelector("#poll-m-cancel").onclick = () => { closeOverlay(ov); resolve(false); };
        input.onkeydown = e => e.key === "Enter" && submit();
      });
    }

    // ─── USER NAME ───────────────────────────────────────────────────────────
    function getStoredName() { return localStorage.getItem("poll_username") || null; }

    function promptName() {
      return new Promise(resolve => {
        const ov = makeOverlay(`
          <div class="poll-modal-icon">👋</div>
          <h3>Join the Poll</h3>
          <p>Enter your name to participate</p>
          <input type="text" id="poll-name-inp" placeholder="Your name" maxlength="40" autocomplete="off"/>
          <div class="poll-modal-error" id="poll-name-err"></div>
          <div class="poll-modal-actions">
            <button class="poll-btn poll-btn-primary" id="poll-m-ok">Let's go →</button>
          </div>`);

        const input = ov.querySelector("#poll-name-inp");
        const error = ov.querySelector("#poll-name-err");
        input.focus();

        function submit() {
          const val = input.value.trim();
          if (!val) { error.textContent = "Please enter your name"; return; }
          localStorage.setItem("poll_username", val);
          closeOverlay(ov);
          resolve(val);
        }
        ov.querySelector("#poll-m-ok").onclick = submit;
        input.onkeydown = e => e.key === "Enter" && submit();
      });
    }

    async function ensureName() {
      userName = getStoredName();
      if (!userName) userName = await promptName();
      return userName;
    }

    // ─── POLL ID ─────────────────────────────────────────────────────────────
    function getPollId(el) {
      if (el.dataset.pollId) return el.dataset.pollId;
      const slide  = el.closest("section");
      const slides = Array.from(document.querySelectorAll(".reveal .slides section:not(.stack)"));
      const idx    = slides.indexOf(slide);
      return `poll_${window.location.pathname.replace(/\W+/g, "_")}_s${idx}`;
    }

    // ─── PARSE ELEMENTS ───────────────────────────────────────────────────────
    function parsePoll(el) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll(".poll-ui, .poll-admin-controls").forEach(n => n.remove());
      const qEl      = clone.querySelector("p strong, strong, p, h1,h2,h3,h4");
      const question = qEl ? qEl.textContent.trim() : "Poll";
      const timerSecs = parseInt(el.dataset.timer ?? DEFAULT_TIMER, 10);

      // Parse options and detect [correct] markers
      const correctIndices = [];
      const options = Array.from(clone.querySelectorAll("li")).map((li, i) => {
        const raw = li.textContent.trim();
        if (/\[correct\]/i.test(raw)) {
          correctIndices.push(i);
          return raw.replace(/\s*\[correct\]/gi, "").trim();
        }
        return raw;
      });

      return { type: "mc", question, options, correctIndices, timerSecs };
    }

    function parseFreeResponse(el) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll(".poll-ui, .poll-admin-controls").forEach(n => n.remove());

      let correctAnswer = "";
      const fullText = clone.textContent || "";
      const match = fullText.match(/\[answer:\s*(.+?)\]/i);
      if (match) correctAnswer = match[1].trim();

      // Strip the [answer:...] node visually
      clone.querySelectorAll("p, li, div").forEach(node => {
        if (/^\[answer:/i.test(node.textContent.trim()) && !node.children.length) node.remove();
      });

      const qEl      = clone.querySelector("p strong, strong, p, h1,h2,h3,h4");
      const question  = qEl ? qEl.textContent.trim() : "Question";
      const timerSecs = parseInt(el.dataset.timer ?? DEFAULT_TIMER, 10);
      return { type: "free", question, correctAnswer, timerSecs };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TIMER
    // ═════════════════════════════════════════════════════════════════════════

    function startCountdown(pollId, timerEl, endTimeMs, totalSecs, onExpire) {
      if (activeTimers[pollId]) clearInterval(activeTimers[pollId]);

      timerEl.dataset.totalSecs = totalSecs;

      function tick() {
        const remaining = Math.max(0, Math.ceil((endTimeMs - Date.now()) / 1000));
        drawTimer(timerEl, remaining, totalSecs);
        if (remaining <= 0) {
          clearInterval(activeTimers[pollId]);
          delete activeTimers[pollId];
          onExpire && onExpire();
        }
      }
      tick();
      activeTimers[pollId] = setInterval(tick, 250);
    }

    function stopCountdown(pollId) {
      if (activeTimers[pollId]) { clearInterval(activeTimers[pollId]); delete activeTimers[pollId]; }
    }

    function drawTimer(el, seconds, totalSecs) {
      if (!el) return;
      const mins    = Math.floor(seconds / 60);
      const secs    = seconds % 60;
      const pad     = n => String(n).padStart(2, "0");
      const pct     = totalSecs > 0 ? Math.min(1, seconds / totalSecs) : 1;
      const r       = 18;
      const circ    = (2 * Math.PI * r).toFixed(2);
      const offset  = ((1 - pct) * 2 * Math.PI * r).toFixed(2);
      const urgency = seconds <= 10 ? "urgent" : seconds <= 30 ? "warning" : "";

      el.className = `poll-timer ${urgency}`;
      el.innerHTML = `
        <svg class="poll-timer-ring" viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="22" r="${r}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3.5"/>
          <circle cx="22" cy="22" r="${r}" fill="none" stroke="currentColor" stroke-width="3.5"
            stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
            stroke-linecap="round" transform="rotate(-90 22 22)"
            style="transition:stroke-dashoffset 0.22s linear"/>
        </svg>
        <span class="poll-timer-digits">${mins > 0 ? `${pad(mins)}:${pad(secs)}` : `${seconds}s`}</span>`;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // AUDIENCE RENDER STATES
    // ═════════════════════════════════════════════════════════════════════════

    function renderWaiting(container) {
      container.innerHTML = `
        <div class="poll-waiting">
          <div class="poll-spinner"></div>
          <p>Waiting for the presenter to start…</p>
        </div>`;
    }

    function renderMCVoting(container, pollId, options, correctIndices, alreadyVoted, timerEl) {
      if (alreadyVoted) {
        container.innerHTML = `
          <div class="poll-voted">
            <div class="poll-voted-icon">✓</div>
            <p>Your vote has been recorded!</p>
            <small>Waiting for the poll to close…</small>
          </div>`;
        if (timerEl) container.prepend(timerEl);
        return;
      }
      container.innerHTML = `
        <div class="poll-options">
          ${options.map((opt, i) => `
            <button class="poll-option" data-index="${i}">
              <span class="poll-option-key">${String.fromCharCode(65 + i)}</span>
              <span class="poll-option-label">${opt}</span>
            </button>`).join("")}
        </div>`;
      if (timerEl) container.prepend(timerEl);

      container.querySelectorAll(".poll-option").forEach(btn => {
        btn.addEventListener("click", async () => {
          container.querySelectorAll(".poll-option").forEach(b => b.disabled = true);
          btn.classList.add("selected");
          await sb.upsert("poll_votes", {
            poll_id: pollId, voter_name: userName,
            option_index: parseInt(btn.dataset.index),
            response_text: null,
            voted_at: new Date().toISOString()
          });
          const t = container.querySelector(".poll-timer");
          container.innerHTML = `
            <div class="poll-voted">
              <div class="poll-voted-icon">✓</div>
              <p>Voted: <strong>${options[parseInt(btn.dataset.index)]}</strong></p>
              <small>Waiting for the poll to close…</small>
            </div>`;
          if (t) container.prepend(t);
        });
      });
    }

    function renderFRInput(container, pollId, alreadyAnswered, timerEl) {
      if (alreadyAnswered) {
        container.innerHTML = `
          <div class="poll-voted">
            <div class="poll-voted-icon">✓</div>
            <p>Answer submitted!</p>
            <small>Waiting for the poll to close…</small>
          </div>`;
        if (timerEl) container.prepend(timerEl);
        return;
      }
      container.innerHTML = `
        <div class="poll-fr-wrap">
          <textarea class="poll-fr-input" placeholder="Type your answer here…" maxlength="500" rows="3"></textarea>
          <div class="poll-fr-footer">
            <span class="poll-fr-chars">0 / 500</span>
            <button class="poll-btn poll-btn-primary poll-fr-submit">Submit →</button>
          </div>
        </div>`;
      if (timerEl) container.prepend(timerEl);

      const ta  = container.querySelector(".poll-fr-input");
      const ch  = container.querySelector(".poll-fr-chars");
      const btn = container.querySelector(".poll-fr-submit");

      ta.addEventListener("input", () => { ch.textContent = `${ta.value.length} / 500`; });
      btn.addEventListener("click", async () => {
        const val = ta.value.trim();
        if (!val) { ta.classList.add("shake"); setTimeout(() => ta.classList.remove("shake"), 500); return; }
        btn.disabled = true;
        btn.textContent = "Submitting…";
        await sb.upsert("poll_votes", {
          poll_id: pollId, voter_name: userName,
          option_index: null, response_text: val,
          voted_at: new Date().toISOString()
        });
        const t = container.querySelector(".poll-timer");
        container.innerHTML = `
          <div class="poll-voted">
            <div class="poll-voted-icon">✓</div>
            <p>Answer submitted!</p>
            <small>Waiting for the poll to close…</small>
          </div>`;
        if (t) container.prepend(t);
      });
    }

    // ─── MC RESULTS ──────────────────────────────────────────────────────────
    async function renderMCResults(container, pollId, options, correctIndices) {
      const votes  = await sb.select("poll_votes", `poll_id=eq.${pollId}`);
      const counts = options.map(() => 0);
      const total  = Array.isArray(votes) ? votes.length : 0;
      if (Array.isArray(votes)) votes.forEach(v => { if (v.option_index != null) counts[v.option_index]++; });

      const hasCorrect = Array.isArray(correctIndices) && correctIndices.length > 0;

      container.innerHTML = `
        <div class="poll-results">
          <div class="poll-total">${total} response${total !== 1 ? "s" : ""}</div>
          ${options.map((opt, i) => {
            const pct        = total ? Math.round(counts[i] / total * 100) : 0;
            const isCorrect  = hasCorrect && correctIndices.includes(i);
            return `
              <div class="poll-result-row ${isCorrect ? "poll-result-correct" : ""}">
                <div class="poll-result-label">
                  <span class="poll-option-key">${String.fromCharCode(65 + i)}</span>
                  ${opt}
                  ${isCorrect ? `<span class="poll-correct-badge">✓</span>` : ""}
                </div>
                <div class="poll-result-bar-wrap">
                  <div class="poll-result-bar ${isCorrect ? "poll-result-bar--correct" : ""}" data-pct="${pct}" style="width:0%"></div>
                </div>
                <div class="poll-result-pct">${pct}%</div>
              </div>`;
          }).join("")}
        </div>`;

      requestAnimationFrame(() => setTimeout(() => {
        container.querySelectorAll(".poll-result-bar").forEach(b => b.style.width = b.dataset.pct + "%");
      }, 80));
    }

    // ─── FREE RESPONSE RESULTS ────────────────────────────────────────────────
    async function renderFRResults(container, pollId, correctAnswer) {
      const votes     = await sb.select("poll_votes", `poll_id=eq.${pollId}`);
      const responses = Array.isArray(votes)
        ? votes.filter(v => v.response_text).map(v => v.response_text)
        : [];

      if (responses.length === 0) {
        container.innerHTML = `<div class="poll-results"><div class="poll-total">No responses yet.</div></div>`;
        return;
      }

      // Show loading skeleton
      container.innerHTML = `
        <div class="poll-fr-results">
          <div class="poll-fr-results-header">
            <span class="poll-total">${responses.length} response${responses.length !== 1 ? "s" : ""}</span>
            ${correctAnswer ? `<span class="poll-fr-correct-ans">Correct: <em>${correctAnswer}</em></span>` : ""}
          </div>
          <div class="poll-fr-ai-loading">
            <div class="poll-spinner" style="width:1.4rem;height:1.4rem;margin:0 0.6rem 0 0;flex-shrink:0"></div>
            <span>Analysing responses with AI…</span>
          </div>
        </div>`;

      if (!CLAUDE_KEY) {
        renderFRResultsRaw(container, responses, correctAnswer);
        return;
      }

      try {
        const analysis = await analyseWithClaude(responses, correctAnswer);
        renderFRResultsAI(container, responses, correctAnswer, analysis);
      } catch (e) {
        console.warn("[Poll] AI analysis failed:", e);
        renderFRResultsRaw(container, responses, correctAnswer);
      }
    }

    async function analyseWithClaude(responses, correctAnswer) {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": CLAUDE_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1200,
          messages: [{
            role: "user",
            content: `You are grading short student answers to a question.

Correct answer: "${correctAnswer}"

Student responses (${responses.length} total):
${responses.map((r, i) => `${i + 1}. ${r}`).join("\n")}

Analyse semantically (not literally). Return ONLY a JSON object, no markdown fences, no preamble:
{
  "pct_correct": <0-100, % semantically correct or close enough>,
  "pct_partial": <0-100, % partially correct>,
  "pct_incorrect": <0-100, % clearly wrong>,
  "mistake_categories": [
    {
      "label": "<short name for this mistake type>",
      "count": <number of students>,
      "example": "<one verbatim example response>",
      "description": "<one sentence explaining this type of mistake>"
    }
  ],
  "insight": "<one sentence for presenter: what's the key misconception or gap?>"
}

Rules:
- pct_correct + pct_partial + pct_incorrect must sum to 100
- mistake_categories covers incorrect + partial responses only
- Group similar mistakes together
- Be generous with pct_correct for semantically equivalent answers`
          }]
        })
      });

      const data = await resp.json();
      const text = (data.content || []).map(c => c.text || "").join("");
      return JSON.parse(text.replace(/```json|```/g, "").trim());
    }

    function renderFRResultsAI(container, responses, correctAnswer, a) {
      container.innerHTML = `
        <div class="poll-fr-results">
          <div class="poll-fr-results-header">
            <span class="poll-total">${responses.length} response${responses.length !== 1 ? "s" : ""}</span>
            ${correctAnswer ? `<span class="poll-fr-correct-ans">Correct: <em>${correctAnswer}</em></span>` : ""}
          </div>

          <div class="poll-fr-score-row">
            <div class="poll-fr-score poll-fr-score--correct">
              <div class="poll-fr-score-pct">${a.pct_correct}%</div>
              <div class="poll-fr-score-label">✓ Correct</div>
            </div>
            <div class="poll-fr-score poll-fr-score--partial">
              <div class="poll-fr-score-pct">${a.pct_partial}%</div>
              <div class="poll-fr-score-label">≈ Partial</div>
            </div>
            <div class="poll-fr-score poll-fr-score--wrong">
              <div class="poll-fr-score-pct">${a.pct_incorrect}%</div>
              <div class="poll-fr-score-label">✗ Incorrect</div>
            </div>
          </div>

          ${a.insight ? `<div class="poll-fr-insight">💡 ${a.insight}</div>` : ""}

          ${a.mistake_categories && a.mistake_categories.length > 0 ? `
            <div class="poll-fr-mistakes-title">Common mistakes</div>
            <div class="poll-fr-mistakes">
              ${a.mistake_categories.map(cat => `
                <div class="poll-fr-mistake">
                  <div class="poll-fr-mistake-top">
                    <span class="poll-fr-mistake-label">${cat.label}</span>
                    <span class="poll-fr-mistake-count">${cat.count} student${cat.count !== 1 ? "s" : ""}</span>
                  </div>
                  <div class="poll-fr-mistake-desc">${cat.description}</div>
                  ${cat.example ? `<blockquote class="poll-fr-mistake-quote">"${cat.example}"</blockquote>` : ""}
                </div>`).join("")}
            </div>` : ""}
        </div>`;
    }

    function renderFRResultsRaw(container, responses, correctAnswer) {
      container.innerHTML = `
        <div class="poll-fr-results">
          <div class="poll-fr-results-header">
            <span class="poll-total">${responses.length} response${responses.length !== 1 ? "s" : ""}</span>
            ${correctAnswer ? `<span class="poll-fr-correct-ans">Correct: <em>${correctAnswer}</em></span>` : ""}
          </div>
          <div class="poll-fr-raw-list">
            ${responses.map(r => `<div class="poll-fr-raw-item">${r}</div>`).join("")}
          </div>
          <div class="poll-fr-no-ai">⚠ Set window.POLL_CLAUDE_API_KEY to enable AI analysis</div>
        </div>`;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // ADMIN CONTROLS
    // ═════════════════════════════════════════════════════════════════════════

    function renderAdminControls(el, pollId, parsed, bodyEl) {
      const isFR  = parsed.type === "free";
      const sid   = pollId.replace(/\W+/g, "_"); // safe DOM id

      const ctrl = document.createElement("div");
      ctrl.className = "poll-admin-controls";
      ctrl.innerHTML = `
        <div class="poll-admin-badge">🎙 Presenter</div>

        <div class="poll-admin-timer-row">
          <span class="poll-admin-timer-label">Timer</span>
          <div class="poll-admin-stepper">
            <button class="poll-btn poll-btn-ghost" id="tdec-${sid}" title="−10s">−10s</button>
            <span class="poll-admin-tval" id="tval-${sid}">${parsed.timerSecs === 0 ? "∞" : parsed.timerSecs + "s"}</span>
            <button class="poll-btn poll-btn-ghost" id="tinc-${sid}" title="+10s">+10s</button>
            <button class="poll-btn poll-btn-ghost" id="tnone-${sid}" title="No timer">∞</button>
          </div>
        </div>

        <div class="poll-admin-btn-row">
          <button class="poll-btn poll-btn-start" id="tstart-${sid}">▶ Start</button>
          <button class="poll-btn poll-btn-stop"  id="tstop-${sid}" disabled>⏹ Close</button>
          ${isFR ? `<button class="poll-btn poll-btn-ai" id="tai-${sid}" disabled>🤖 Analyse</button>` : ""}
        </div>

        <div class="poll-admin-footer">
          <span class="poll-admin-status" id="tstat-${sid}">idle</span>
          <span class="poll-admin-count"  id="tcnt-${sid}"></span>
        </div>
        <div class="poll-admin-timer-live" id="tlive-${sid}"></div>
      `;
      el.appendChild(ctrl);

      const btnStart = ctrl.querySelector(`#tstart-${sid}`);
      const btnStop  = ctrl.querySelector(`#tstop-${sid}`);
      const btnAI    = ctrl.querySelector(`#tai-${sid}`);
      const statusEl = ctrl.querySelector(`#tstat-${sid}`);
      const countEl  = ctrl.querySelector(`#tcnt-${sid}`);
      const tvalEl   = ctrl.querySelector(`#tval-${sid}`);
      const timerLiveEl = ctrl.querySelector(`#tlive-${sid}`);

      let timerSecs = parsed.timerSecs;
      let countInterval = null;

      function updateTval() {
        tvalEl.textContent = timerSecs === 0 ? "∞" : `${timerSecs}s`;
      }

      async function pushTimerChange() {
        const rows = await sb.select("poll_sessions", `poll_id=eq.${pollId}`);
        const row  = Array.isArray(rows) && rows[0];
        if (!row || row.status !== "open") return;
        const newEnd = timerSecs > 0 ? new Date(Date.now() + timerSecs * 1000).toISOString() : null;
        await sb.update("poll_sessions", `poll_id=eq.${pollId}`, {
          timer_secs: timerSecs, timer_end: newEnd, updated_at: new Date().toISOString()
        });
        // Restart local timer too
        if (timerSecs > 0) {
          startCountdown(pollId, timerLiveEl, Date.now() + timerSecs * 1000, timerSecs, doAutoClose);
        } else {
          stopCountdown(pollId);
          timerLiveEl.innerHTML = "";
        }
      }

      ctrl.querySelector(`#tdec-${sid}`).onclick = () => { timerSecs = Math.max(0, timerSecs - 10); updateTval(); pushTimerChange(); };
      ctrl.querySelector(`#tinc-${sid}`).onclick = () => { timerSecs = Math.min(600, timerSecs + 10); updateTval(); pushTimerChange(); };
      ctrl.querySelector(`#tnone-${sid}`).onclick = () => { timerSecs = 0; updateTval(); pushTimerChange(); };

      async function refreshCount() {
        const v = await sb.select("poll_votes", `poll_id=eq.${pollId}`);
        if (Array.isArray(v)) countEl.textContent = `${v.length} response${v.length !== 1 ? "s" : ""}`;
      }

      async function doAutoClose() {
        if (btnStop.disabled) return;
        await runClose();
      }

      async function runOpen() {
        btnStart.disabled = true;
        btnStop.disabled  = false;
        if (btnAI) btnAI.disabled = true;
        statusEl.textContent = "open";

        const timerEnd = timerSecs > 0 ? new Date(Date.now() + timerSecs * 1000).toISOString() : null;
        await sb.upsert("poll_sessions", {
          poll_id: pollId,
          status: "open",
          poll_type: parsed.type,
          question: parsed.question,
          options: parsed.type === "mc" ? JSON.stringify(parsed.options) : null,
          correct_indices: parsed.correctIndices?.length ? JSON.stringify(parsed.correctIndices) : null,
          correct_answer: parsed.correctAnswer || null,
          timer_secs: timerSecs,
          timer_end: timerEnd,
          updated_at: new Date().toISOString()
        });

        if (timerSecs > 0) {
          startCountdown(pollId, timerLiveEl, Date.now() + timerSecs * 1000, timerSecs, doAutoClose);
        }
        countInterval = setInterval(refreshCount, 3000);
        refreshCount();
      }

      async function runClose() {
        btnStop.disabled = true;
        statusEl.textContent = "closed";
        countEl.textContent = "";
        clearInterval(countInterval);
        stopCountdown(pollId);
        timerLiveEl.innerHTML = "";

        await sb.update("poll_sessions", `poll_id=eq.${pollId}`, {
          status: "closed", timer_end: null, updated_at: new Date().toISOString()
        });

        if (isFR) {
          await renderFRResults(bodyEl, pollId, parsed.correctAnswer);
          if (btnAI) btnAI.disabled = false;
        } else {
          await renderMCResults(bodyEl, pollId, parsed.options, parsed.correctIndices);
        }
      }

      btnStart.addEventListener("click", runOpen);
      btnStop.addEventListener("click",  runClose);

      if (btnAI) {
        btnAI.addEventListener("click", async () => {
          btnAI.disabled = true;
          btnAI.textContent = "🤖 Analysing…";
          await renderFRResults(bodyEl, pollId, parsed.correctAnswer);
          btnAI.textContent = "🤖 Analyse";
          btnAI.disabled = false;
        });
      }

      // Restore DB state on load
      sb.select("poll_sessions", `poll_id=eq.${pollId}`).then(rows => {
        const row = Array.isArray(rows) && rows[0];
        if (!row) return;

        timerSecs = row.timer_secs ?? timerSecs;
        updateTval();
        statusEl.textContent = row.status;

        if (row.status === "open") {
          btnStart.disabled = true;
          btnStop.disabled  = false;
          if (btnAI) btnAI.disabled = true;
          countInterval = setInterval(refreshCount, 3000);
          refreshCount();
          if (row.timer_end) {
            startCountdown(pollId, timerLiveEl, new Date(row.timer_end).getTime(), row.timer_secs || timerSecs, doAutoClose);
          }
        } else if (row.status === "closed") {
          btnStart.disabled = true;
          btnStop.disabled  = true;
          if (btnAI) btnAI.disabled = false;
        }
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // INIT SINGLE POLL ELEMENT
    // ═════════════════════════════════════════════════════════════════════════

    async function initPollEl(el) {
      if (el.dataset.pollInited) return;
      el.dataset.pollInited = "1";

      const isFR   = el.classList.contains("freeresponse");
      const parsed = isFR ? parseFreeResponse(el) : parsePoll(el);
      const pollId = getPollId(el);
      const sid    = pollId.replace(/\W+/g, "_");

      el.innerHTML = `
        <div class="poll-question">${parsed.question}</div>
        <div class="poll-body" id="pb-${sid}"></div>`;
      const bodyEl = el.querySelector(`#pb-${sid}`);

      if (isAdmin) {
        renderAdminControls(el, pollId, parsed, bodyEl);
        const rows = await sb.select("poll_sessions", `poll_id=eq.${pollId}`);
        const row  = Array.isArray(rows) && rows[0];

        if (row?.status === "closed") {
          if (isFR) await renderFRResults(bodyEl, pollId, parsed.correctAnswer || row.correct_answer || "");
          else      await renderMCResults(bodyEl, pollId, parsed.options, parsed.correctIndices);
        } else if (!isFR) {
          bodyEl.innerHTML = `
            <div class="poll-admin-preview">
              ${parsed.options.map((o, i) =>
                `<div class="poll-preview-opt">
                  <span class="poll-option-key">${String.fromCharCode(65 + i)}</span>${o}
                </div>`).join("")}
            </div>`;
        } else {
          bodyEl.innerHTML = `
            <div class="poll-admin-preview poll-fr-preview">
              <div>📝 Free response question</div>
              <small>Correct answer saved. AI will grade on close.</small>
            </div>`;
        }
        return;
      }

      // ── AUDIENCE ──
      await ensureName();
      const rows = await sb.select("poll_sessions", `poll_id=eq.${pollId}`);
      const row  = Array.isArray(rows) && rows[0];
      const status = row?.status || "idle";

      if (status === "open") {
        const myVotes  = await sb.select("poll_votes",
          `poll_id=eq.${pollId}&voter_name=eq.${encodeURIComponent(userName)}`);
        const hasVoted = Array.isArray(myVotes) && myVotes.length > 0;

        let timerEl = null;
        if (row.timer_end && !hasVoted) {
          timerEl = document.createElement("div");
          startCountdown(pollId, timerEl, new Date(row.timer_end).getTime(), row.timer_secs || parsed.timerSecs, () => {});
        }

        if (isFR) renderFRInput(bodyEl, pollId, hasVoted, timerEl);
        else       renderMCVoting(bodyEl, pollId, parsed.options, parsed.correctIndices, hasVoted, timerEl);

      } else if (status === "closed") {
        const opts = row.options ? JSON.parse(row.options) : parsed.options;
        const ci   = row.correct_indices ? JSON.parse(row.correct_indices) : parsed.correctIndices;
        if (isFR) await renderFRResults(bodyEl, pollId, row.correct_answer || "");
        else      await renderMCResults(bodyEl, pollId, opts, ci);
      } else {
        renderWaiting(bodyEl);
      }

      // ── REALTIME ──
      if (activeSockets[pollId]) { try { activeSockets[pollId].close(); } catch(e){} }

      activeSockets[pollId] = sb.realtime("poll_sessions", async (event, record) => {
        if (!record || record.poll_id !== pollId) return;

        if (record.status === "open") {
          const myVotes  = await sb.select("poll_votes",
            `poll_id=eq.${pollId}&voter_name=eq.${encodeURIComponent(userName)}`);
          const hasVoted = Array.isArray(myVotes) && myVotes.length > 0;

          let timerEl = null;
          if (record.timer_end && !hasVoted) {
            timerEl = document.createElement("div");
            startCountdown(pollId, timerEl, new Date(record.timer_end).getTime(),
              record.timer_secs || parsed.timerSecs, () => {});
          } else {
            stopCountdown(pollId);
          }

          const opts = record.options ? JSON.parse(record.options) : parsed.options;
          if (isFR) renderFRInput(bodyEl, pollId, hasVoted, timerEl);
          else       renderMCVoting(bodyEl, pollId, opts, parsed.correctIndices, hasVoted, timerEl);

        } else if (record.status === "closed") {
          stopCountdown(pollId);
          const opts = record.options ? JSON.parse(record.options) : parsed.options;
          const ci   = record.correct_indices ? JSON.parse(record.correct_indices) : parsed.correctIndices;
          if (isFR) await renderFRResults(bodyEl, pollId, record.correct_answer || "");
          else      await renderMCResults(bodyEl, pollId, opts, ci);
        }
      });
    }

    // ─── ADMIN CORNER BUTTON ──────────────────────────────────────────────────
    function addAdminToggle() {
      const btn = document.createElement("button");
      btn.className = "poll-admin-toggle";
      btn.title     = "Presenter mode";
      btn.textContent = "🎙";
      btn.addEventListener("click", async () => {
        if (isAdmin) return;
        const ok = await promptAdmin();
        if (ok) {
          isAdmin = true;
          btn.classList.add("active");
          document.querySelectorAll(".poll, .freeresponse").forEach(el => {
            delete el.dataset.pollInited;
            initPollEl(el);
          });
        }
      });
      document.querySelector(".reveal")?.appendChild(btn);
    }

    // ─── BOOTSTRAP ───────────────────────────────────────────────────────────
    isAdmin = checkAdminSession();
    addAdminToggle();
    if (isAdmin) document.querySelector(".poll-admin-toggle")?.classList.add("active");

    function initCurrentSlide() {
      const slide = deck.getCurrentSlide();
      if (!slide) return;
      slide.querySelectorAll(".poll, .freeresponse").forEach(el => initPollEl(el));
    }

    deck.on("ready",        initCurrentSlide);
    deck.on("slidechanged", initCurrentSlide);
    if (isAdmin) setTimeout(initCurrentSlide, 200);
  }
};
