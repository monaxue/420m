/**
 * Quarto RevealJS Poll Extension v2
 * ─────────────────────────────────────────────────────────────────
 * • :::poll:::          — multiple-choice poll
 * • :::freeresponse:::  — free-text answer with AI grading
 * • [correct] marker on MC options
 * • Countdown timer, synced via Supabase Realtime
 * • All UI inline — no popups or modals
 * • Admin password inline in poll corner
 * • Admin can toggle audience preview
 * • Inputs work correctly inside RevealJS (keyboard capture fix)
 */

window.RevealPoll = {
  id: "RevealPoll",
  init: async function (deck) {

    const SUPABASE_URL  = window.POLL_SUPABASE_URL  || "";
    const SUPABASE_ANON = window.POLL_SUPABASE_ANON || "";
    const ADMIN_PASS    = window.POLL_ADMIN_PASSWORD || "admin";
    const CLAUDE_KEY    = window.POLL_CLAUDE_API_KEY || "";
    const DEFAULT_TIMER = parseInt(window.POLL_DEFAULT_TIMER ?? "60", 10);

    if (!SUPABASE_URL || !SUPABASE_ANON) {
      console.warn("[Poll] Missing Supabase credentials.");
    }

    // ── FIX: Stop RevealJS stealing keyboard input from text fields ──────────
    document.addEventListener("keydown", e => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
        e.stopPropagation();
      }
    }, true);

    // ── SUPABASE CLIENT ──────────────────────────────────────────────────────
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
          if (["INSERT","UPDATE","DELETE"].includes(msg.event)) cb(msg.event, msg.payload?.record);
        };
        ws.onerror = e => console.warn("[Poll] WebSocket error", e);
        return ws;
      }
    };

    // ── STATE ────────────────────────────────────────────────────────────────
    let isAdmin      = false;
    let adminPreview = false;
    let userName     = null;
    const activeSockets = {};
    const activeTimers  = {};

    const getStoredName = ()  => localStorage.getItem("poll_username") || null;
    const setStoredName = (n) => localStorage.setItem("poll_username", n);
    const checkAdminSession = () => sessionStorage.getItem("poll_admin") === "1";

    // ── POLL ID ──────────────────────────────────────────────────────────────
    function getPollId(el) {
      if (el.dataset.pollId) return el.dataset.pollId;
      const slides = Array.from(document.querySelectorAll(".reveal .slides section:not(.stack)"));
      const idx    = slides.indexOf(el.closest("section"));
      return `poll_${window.location.pathname.replace(/\W+/g, "_")}_s${idx}`;
    }

    // ── PARSE ────────────────────────────────────────────────────────────────
    function parsePoll(el) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll(".poll-ui,.poll-admin-controls").forEach(n => n.remove());
      const qEl       = clone.querySelector("p strong,strong,p,h1,h2,h3,h4");
      const question  = qEl ? qEl.textContent.trim() : "Poll";
      const timerSecs = parseInt(el.dataset.timer ?? DEFAULT_TIMER, 10);
      const correctIndices = [];
      const options = Array.from(clone.querySelectorAll("li")).map((li, i) => {
        const raw = li.textContent.trim();
        if (/\[correct\]/i.test(raw)) { correctIndices.push(i); return raw.replace(/\s*\[correct\]/gi,"").trim(); }
        return raw;
      });
      return { type:"mc", question, options, correctIndices, timerSecs };
    }

    function parseFreeResponse(el) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll(".poll-ui,.poll-admin-controls").forEach(n => n.remove());
      const fullText    = clone.textContent || "";
      const match       = fullText.match(/\[answer:\s*(.+?)\]/i);
      const correctAnswer = match ? match[1].trim() : "";
      clone.querySelectorAll("p,li,div").forEach(node => {
        if (/^\[answer:/i.test(node.textContent.trim()) && !node.children.length) node.remove();
      });
      const qEl       = clone.querySelector("p strong,strong,p,h1,h2,h3,h4");
      const question  = qEl ? qEl.textContent.trim() : "Question";
      const timerSecs = parseInt(el.dataset.timer ?? DEFAULT_TIMER, 10);
      return { type:"free", question, correctAnswer, timerSecs };
    }

    // ── TIMER ────────────────────────────────────────────────────────────────
    function startCountdown(pollId, el, endMs, totalSecs, onExpire) {
      if (activeTimers[pollId]) clearInterval(activeTimers[pollId]);
      const tick = () => {
        const rem = Math.max(0, Math.ceil((endMs - Date.now()) / 1000));
        drawTimer(el, rem, totalSecs);
        if (rem <= 0) { clearInterval(activeTimers[pollId]); delete activeTimers[pollId]; onExpire?.(); }
      };
      tick();
      activeTimers[pollId] = setInterval(tick, 250);
    }

    function stopCountdown(pollId) {
      if (activeTimers[pollId]) { clearInterval(activeTimers[pollId]); delete activeTimers[pollId]; }
    }

    function drawTimer(el, seconds, totalSecs) {
      if (!el) return;
      const mins = Math.floor(seconds / 60), secs = seconds % 60;
      const pad  = n => String(n).padStart(2,"0");
      const pct  = totalSecs > 0 ? Math.min(1, seconds / totalSecs) : 1;
      const r = 18, circ = (2*Math.PI*r).toFixed(2);
      const offset  = ((1-pct)*2*Math.PI*r).toFixed(2);
      const urgency = seconds <= 10 ? "urgent" : seconds <= 30 ? "warning" : "";
      el.className = `poll-timer ${urgency}`;
      el.innerHTML = `
        <svg class="poll-timer-ring" viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="22" r="${r}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3.5"/>
          <circle cx="22" cy="22" r="${r}" fill="none" stroke="currentColor" stroke-width="3.5"
            stroke-dasharray="${circ}" stroke-dashoffset="${offset}" stroke-linecap="round"
            transform="rotate(-90 22 22)" style="transition:stroke-dashoffset 0.22s linear"/>
        </svg>
        <span class="poll-timer-digits">${mins > 0 ? `${pad(mins)}:${pad(secs)}` : `${seconds}s`}</span>`;
    }

    // ── INLINE NAME ENTRY ────────────────────────────────────────────────────
    function renderNameEntry(container, onJoin) {
      container.innerHTML = `
        <div class="poll-name-step">
          <div class="poll-name-label">Enter your name to join</div>
          <div class="poll-name-row">
            <input class="poll-name-input" type="text" placeholder="Your name…" maxlength="40" autocomplete="off"/>
            <button class="poll-btn poll-btn-primary poll-name-btn">Join →</button>
          </div>
          <div class="poll-name-error"></div>
        </div>`;
      const input = container.querySelector(".poll-name-input");
      const btn   = container.querySelector(".poll-name-btn");
      const err   = container.querySelector(".poll-name-error");
      setTimeout(() => input.focus(), 80);
      const submit = () => {
        const val = input.value.trim();
        if (!val) { err.textContent = "Please enter your name"; return; }
        setStoredName(val); userName = val; onJoin(val);
      };
      btn.addEventListener("click", submit);
      input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
    }

    // ── INLINE ADMIN PASSWORD CORNER ─────────────────────────────────────────
    function renderAdminPwCorner(el, onSuccess) {
      const corner = document.createElement("div");
      corner.className = "poll-admin-pw-corner";
      corner.innerHTML = `
        <input class="poll-admin-pw-input" type="password" placeholder="presenter pw" autocomplete="off"/>
        <button class="poll-admin-pw-btn">→</button>
        <span class="poll-admin-pw-err"></span>`;
      el.appendChild(corner);
      const input = corner.querySelector(".poll-admin-pw-input");
      const btn   = corner.querySelector(".poll-admin-pw-btn");
      const err   = corner.querySelector(".poll-admin-pw-err");
      const submit = () => {
        if (input.value === ADMIN_PASS) {
          sessionStorage.setItem("poll_admin","1");
          corner.remove();
          onSuccess();
        } else {
          err.textContent = "✗"; input.value = "";
          input.classList.add("shake");
          setTimeout(() => { input.classList.remove("shake"); err.textContent = ""; }, 500);
        }
      };
      btn.addEventListener("click", submit);
      input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
    }

    // ── AUDIENCE STATES ──────────────────────────────────────────────────────
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
            <div class="poll-voted-text"><p>Vote recorded!</p><small>Waiting for the poll to close…</small></div>
          </div>`;
        if (timerEl) container.prepend(timerEl);
        return;
      }
      container.innerHTML = `
        <div class="poll-options">
          ${options.map((opt,i) => `
            <button class="poll-option" data-index="${i}">
              <span class="poll-option-key">${String.fromCharCode(65+i)}</span>
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
            option_index: parseInt(btn.dataset.index), response_text: null,
            voted_at: new Date().toISOString()
          });
          const t = container.querySelector(".poll-timer");
          container.innerHTML = `
            <div class="poll-voted">
              <div class="poll-voted-icon">✓</div>
              <div class="poll-voted-text">
                <p>Voted: <strong>${options[parseInt(btn.dataset.index)]}</strong></p>
                <small>Waiting for the poll to close…</small>
              </div>
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
            <div class="poll-voted-text"><p>Answer submitted!</p><small>Waiting for the poll to close…</small></div>
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
        if (!val) { ta.classList.add("shake"); setTimeout(() => ta.classList.remove("shake"),500); return; }
        btn.disabled = true; btn.textContent = "Submitting…";
        await sb.upsert("poll_votes", {
          poll_id: pollId, voter_name: userName,
          option_index: null, response_text: val, voted_at: new Date().toISOString()
        });
        const t = container.querySelector(".poll-timer");
        container.innerHTML = `
          <div class="poll-voted">
            <div class="poll-voted-icon">✓</div>
            <div class="poll-voted-text"><p>Answer submitted!</p><small>Waiting for the poll to close…</small></div>
          </div>`;
        if (t) container.prepend(t);
      });
    }

    // ── RESULTS ──────────────────────────────────────────────────────────────
    async function renderMCResults(container, pollId, options, correctIndices) {
      const votes  = await sb.select("poll_votes", `poll_id=eq.${pollId}`);
      const counts = options.map(() => 0);
      const total  = Array.isArray(votes) ? votes.length : 0;
      if (Array.isArray(votes)) votes.forEach(v => { if (v.option_index != null) counts[v.option_index]++; });
      const hasCorrect = Array.isArray(correctIndices) && correctIndices.length > 0;
      container.innerHTML = `
        <div class="poll-results">
          <div class="poll-total">${total} response${total !== 1 ? "s" : ""}</div>
          ${options.map((opt,i) => {
            const pct = total ? Math.round(counts[i]/total*100) : 0;
            const isC = hasCorrect && correctIndices.includes(i);
            return `
              <div class="poll-result-row ${isC ? "poll-result-correct" : ""}">
                <div class="poll-result-label">
                  <span class="poll-option-key">${String.fromCharCode(65+i)}</span>
                  ${opt}${isC ? `<span class="poll-correct-badge">✓</span>` : ""}
                </div>
                <div class="poll-result-bar-wrap">
                  <div class="poll-result-bar ${isC ? "poll-result-bar--correct" : ""}" data-pct="${pct}" style="width:0%"></div>
                </div>
                <div class="poll-result-pct">${pct}%</div>
              </div>`;
          }).join("")}
        </div>`;
      requestAnimationFrame(() => setTimeout(() => {
        container.querySelectorAll(".poll-result-bar").forEach(b => b.style.width = b.dataset.pct + "%");
      }, 80));
    }

    async function renderFRResults(container, pollId, correctAnswer) {
      const votes     = await sb.select("poll_votes", `poll_id=eq.${pollId}`);
      const responses = Array.isArray(votes) ? votes.filter(v => v.response_text).map(v => v.response_text) : [];
      if (responses.length === 0) {
        container.innerHTML = `<div class="poll-results"><div class="poll-total">No responses yet.</div></div>`;
        return;
      }
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
      if (!CLAUDE_KEY) { renderFRResultsRaw(container, responses, correctAnswer); return; }
      try {
        renderFRResultsAI(container, responses, correctAnswer, await analyseWithClaude(responses, correctAnswer));
      } catch(e) {
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
          model: "claude-sonnet-4-20250514", max_tokens: 1200,
          messages: [{ role: "user", content:
            `You are grading short student answers.\n\nCorrect answer: "${correctAnswer}"\n\nStudent responses (${responses.length} total):\n${responses.map((r,i)=>`${i+1}. ${r}`).join("\n")}\n\nAnalyse semantically. Return ONLY JSON, no markdown:\n{\n  "pct_correct": <0-100>,\n  "pct_partial": <0-100>,\n  "pct_incorrect": <0-100>,\n  "mistake_categories": [{"label":"","count":0,"example":"","description":""}],\n  "insight": ""\n}\npct_correct+pct_partial+pct_incorrect must sum to 100.`
          }]
        })
      });
      const data = await resp.json();
      const text = (data.content||[]).map(c=>c.text||"").join("");
      return JSON.parse(text.replace(/```json|```/g,"").trim());
    }

    function renderFRResultsAI(container, responses, correctAnswer, a) {
      container.innerHTML = `
        <div class="poll-fr-results">
          <div class="poll-fr-results-header">
            <span class="poll-total">${responses.length} response${responses.length!==1?"s":""}</span>
            ${correctAnswer?`<span class="poll-fr-correct-ans">Correct: <em>${correctAnswer}</em></span>`:""}
          </div>
          <div class="poll-fr-score-row">
            <div class="poll-fr-score poll-fr-score--correct"><div class="poll-fr-score-pct">${a.pct_correct}%</div><div class="poll-fr-score-label">✓ Correct</div></div>
            <div class="poll-fr-score poll-fr-score--partial"><div class="poll-fr-score-pct">${a.pct_partial}%</div><div class="poll-fr-score-label">≈ Partial</div></div>
            <div class="poll-fr-score poll-fr-score--wrong"><div class="poll-fr-score-pct">${a.pct_incorrect}%</div><div class="poll-fr-score-label">✗ Incorrect</div></div>
          </div>
          ${a.insight?`<div class="poll-fr-insight">💡 ${a.insight}</div>`:""}
          ${a.mistake_categories?.length?`
            <div class="poll-fr-mistakes-title">Common mistakes</div>
            <div class="poll-fr-mistakes">
              ${a.mistake_categories.map(cat=>`
                <div class="poll-fr-mistake">
                  <div class="poll-fr-mistake-top">
                    <span class="poll-fr-mistake-label">${cat.label}</span>
                    <span class="poll-fr-mistake-count">${cat.count} student${cat.count!==1?"s":""}</span>
                  </div>
                  <div class="poll-fr-mistake-desc">${cat.description}</div>
                  ${cat.example?`<blockquote class="poll-fr-mistake-quote">"${cat.example}"</blockquote>`:""}
                </div>`).join("")}
            </div>`:""}
        </div>`;
    }

    function renderFRResultsRaw(container, responses, correctAnswer) {
      container.innerHTML = `
        <div class="poll-fr-results">
          <div class="poll-fr-results-header">
            <span class="poll-total">${responses.length} response${responses.length!==1?"s":""}</span>
            ${correctAnswer?`<span class="poll-fr-correct-ans">Correct: <em>${correctAnswer}</em></span>`:""}
          </div>
          <div class="poll-fr-raw-list">${responses.map(r=>`<div class="poll-fr-raw-item">${r}</div>`).join("")}</div>
          <div class="poll-fr-no-ai">⚠ Set window.POLL_CLAUDE_API_KEY to enable AI analysis</div>
        </div>`;
    }

    // ── ADMIN CONTROLS ───────────────────────────────────────────────────────
    function renderAdminControls(el, pollId, parsed, bodyEl) {
      const isFR = parsed.type === "free";
      const sid  = pollId.replace(/\W+/g,"_");
      const ctrl = document.createElement("div");
      ctrl.className = "poll-admin-controls";
      ctrl.innerHTML = `
        <div class="poll-admin-top-row">
          <div class="poll-admin-badge">🎙 Presenter</div>
          <button class="poll-btn poll-btn-ghost poll-preview-toggle" id="tprev-${sid}">👁 Audience view</button>
        </div>
        <div class="poll-admin-timer-row">
          <span class="poll-admin-timer-label">Timer</span>
          <div class="poll-admin-stepper">
            <button class="poll-btn poll-btn-ghost" id="tdec-${sid}">−10s</button>
            <span class="poll-admin-tval" id="tval-${sid}">${parsed.timerSecs===0?"∞":parsed.timerSecs+"s"}</span>
            <button class="poll-btn poll-btn-ghost" id="tinc-${sid}">+10s</button>
            <button class="poll-btn poll-btn-ghost" id="tnone-${sid}">∞</button>
          </div>
        </div>
        <div class="poll-admin-btn-row">
          <button class="poll-btn poll-btn-start" id="tstart-${sid}">▶ Start</button>
          <button class="poll-btn poll-btn-stop"  id="tstop-${sid}" disabled>⏹ Close</button>
          ${isFR?`<button class="poll-btn poll-btn-ai" id="tai-${sid}" disabled>🤖 Analyse</button>`:""}
        </div>
        <div class="poll-admin-footer">
          <span class="poll-admin-status" id="tstat-${sid}">idle</span>
          <span class="poll-admin-count"  id="tcnt-${sid}"></span>
        </div>
        <div class="poll-admin-timer-live" id="tlive-${sid}"></div>`;
      el.appendChild(ctrl);

      const btnStart    = ctrl.querySelector(`#tstart-${sid}`);
      const btnStop     = ctrl.querySelector(`#tstop-${sid}`);
      const btnAI       = ctrl.querySelector(`#tai-${sid}`);
      const btnPreview  = ctrl.querySelector(`#tprev-${sid}`);
      const statusEl    = ctrl.querySelector(`#tstat-${sid}`);
      const countEl     = ctrl.querySelector(`#tcnt-${sid}`);
      const tvalEl      = ctrl.querySelector(`#tval-${sid}`);
      const timerLiveEl = ctrl.querySelector(`#tlive-${sid}`);
      let timerSecs     = parsed.timerSecs;
      let countInterval = null;

      const updateTval = () => { tvalEl.textContent = timerSecs===0?"∞":`${timerSecs}s`; };

      async function pushTimerChange() {
        const rows = await sb.select("poll_sessions",`poll_id=eq.${pollId}`);
        const row  = Array.isArray(rows) && rows[0];
        if (!row || row.status !== "open") return;
        const newEnd = timerSecs > 0 ? new Date(Date.now()+timerSecs*1000).toISOString() : null;
        await sb.update("poll_sessions",`poll_id=eq.${pollId}`,{
          timer_secs:timerSecs, timer_end:newEnd, updated_at:new Date().toISOString()
        });
        if (timerSecs > 0) startCountdown(pollId, timerLiveEl, Date.now()+timerSecs*1000, timerSecs, doAutoClose);
        else { stopCountdown(pollId); timerLiveEl.innerHTML=""; }
      }

      ctrl.querySelector(`#tdec-${sid}`).onclick  = () => { timerSecs=Math.max(0,timerSecs-10);   updateTval(); pushTimerChange(); };
      ctrl.querySelector(`#tinc-${sid}`).onclick  = () => { timerSecs=Math.min(600,timerSecs+10); updateTval(); pushTimerChange(); };
      ctrl.querySelector(`#tnone-${sid}`).onclick = () => { timerSecs=0; updateTval(); pushTimerChange(); };

      // Audience preview toggle
      btnPreview.addEventListener("click", () => {
        adminPreview = !adminPreview;
        btnPreview.textContent = adminPreview ? "🎙 Back to presenter" : "👁 Audience view";
        btnPreview.classList.toggle("active", adminPreview);
        delete el.dataset.pollInited;
        initPollEl(el);
      });

      const refreshCount = async () => {
        const v = await sb.select("poll_votes",`poll_id=eq.${pollId}`);
        if (Array.isArray(v)) countEl.textContent = `${v.length} response${v.length!==1?"s":""}`;
      };

      const doAutoClose = async () => { if (!btnStop.disabled) await runClose(); };

      const runOpen = async () => {
        btnStart.disabled = true; btnStop.disabled = false;
        if (btnAI) btnAI.disabled = true;
        statusEl.textContent = "open";
        const timerEnd = timerSecs>0 ? new Date(Date.now()+timerSecs*1000).toISOString() : null;
        await sb.upsert("poll_sessions", {
          poll_id:pollId, status:"open", poll_type:parsed.type, question:parsed.question,
          options:parsed.type==="mc"?JSON.stringify(parsed.options):null,
          correct_indices:parsed.correctIndices?.length?JSON.stringify(parsed.correctIndices):null,
          correct_answer:parsed.correctAnswer||null,
          timer_secs:timerSecs, timer_end:timerEnd, updated_at:new Date().toISOString()
        });
        if (timerSecs>0) startCountdown(pollId, timerLiveEl, Date.now()+timerSecs*1000, timerSecs, doAutoClose);
        countInterval = setInterval(refreshCount, 3000);
        refreshCount();
      };

      const runClose = async () => {
        btnStop.disabled = true; statusEl.textContent = "closed"; countEl.textContent = "";
        clearInterval(countInterval); stopCountdown(pollId); timerLiveEl.innerHTML = "";
        await sb.update("poll_sessions",`poll_id=eq.${pollId}`,{
          status:"closed", timer_end:null, updated_at:new Date().toISOString()
        });
        if (isFR) { await renderFRResults(bodyEl,pollId,parsed.correctAnswer); if (btnAI) btnAI.disabled=false; }
        else        await renderMCResults(bodyEl,pollId,parsed.options,parsed.correctIndices);
      };

      btnStart.addEventListener("click", runOpen);
      btnStop.addEventListener("click",  runClose);
      if (btnAI) {
        btnAI.addEventListener("click", async () => {
          btnAI.disabled=true; btnAI.textContent="🤖 Analysing…";
          await renderFRResults(bodyEl,pollId,parsed.correctAnswer);
          btnAI.textContent="🤖 Analyse"; btnAI.disabled=false;
        });
      }

      // Restore state on load
      sb.select("poll_sessions",`poll_id=eq.${pollId}`).then(rows => {
        const row = Array.isArray(rows) && rows[0];
        if (!row) return;
        timerSecs = row.timer_secs ?? timerSecs; updateTval();
        statusEl.textContent = row.status;
        if (row.status==="open") {
          btnStart.disabled=true; btnStop.disabled=false;
          if (btnAI) btnAI.disabled=true;
          countInterval=setInterval(refreshCount,3000); refreshCount();
          if (row.timer_end) startCountdown(pollId,timerLiveEl,new Date(row.timer_end).getTime(),row.timer_secs||timerSecs,doAutoClose);
        } else if (row.status==="closed") {
          btnStart.disabled=true; btnStop.disabled=true;
          if (btnAI) btnAI.disabled=false;
        }
      });
    }

    // ── INIT POLL ELEMENT ────────────────────────────────────────────────────
    async function initPollEl(el) {
      if (el.dataset.pollInited) return;
      el.dataset.pollInited = "1";

      const isFR   = el.classList.contains("freeresponse");
      const parsed = isFR ? parseFreeResponse(el) : parsePoll(el);
      const pollId = getPollId(el);
      const sid    = pollId.replace(/\W+/g,"_");

      el.innerHTML = `
        <div class="poll-question">${parsed.question}</div>
        <div class="poll-body" id="pb-${sid}"></div>`;
      const bodyEl = el.querySelector(`#pb-${sid}`);

      // ── ADMIN (presenter) view ──
      if (isAdmin && !adminPreview) {
        renderAdminControls(el, pollId, parsed, bodyEl);
        const rows = await sb.select("poll_sessions",`poll_id=eq.${pollId}`);
        const row  = Array.isArray(rows) && rows[0];
        if (row?.status==="closed") {
          if (isFR) await renderFRResults(bodyEl,pollId,parsed.correctAnswer||row.correct_answer||"");
          else      await renderMCResults(bodyEl,pollId,parsed.options,parsed.correctIndices);
        } else if (!isFR) {
          bodyEl.innerHTML = `
            <div class="poll-admin-preview">
              ${parsed.options.map((o,i)=>`
                <div class="poll-preview-opt">
                  <span class="poll-option-key">${String.fromCharCode(65+i)}</span>${o}
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

      // ── AUDIENCE (or admin preview) view ──

      // Show inline password corner if not yet admin
      if (!isAdmin) {
        renderAdminPwCorner(el, () => {
          isAdmin = true; adminPreview = false;
          document.querySelectorAll(".poll,.freeresponse").forEach(p => {
            delete p.dataset.pollInited; initPollEl(p);
          });
        });
      } else if (adminPreview) {
        // "Back to presenter" button when in preview mode
        const backBtn = document.createElement("button");
        backBtn.className = "poll-btn poll-btn-ghost poll-preview-back";
        backBtn.textContent = "🎙 Back to presenter";
        backBtn.addEventListener("click", () => {
          adminPreview = false;
          delete el.dataset.pollInited;
          initPollEl(el);
        });
        el.insertBefore(backBtn, bodyEl);
      }

      // Name entry inline
      const storedName = getStoredName();
      if (!storedName) {
        renderNameEntry(bodyEl, () => { delete el.dataset.pollInited; initPollEl(el); });
        return;
      }
      userName = storedName;

      // Fetch and render poll state
      const rows   = await sb.select("poll_sessions",`poll_id=eq.${pollId}`);
      const row    = Array.isArray(rows) && rows[0];
      const status = row?.status || "idle";

      if (status==="open") {
        const myVotes  = await sb.select("poll_votes",`poll_id=eq.${pollId}&voter_name=eq.${encodeURIComponent(userName)}`);
        const hasVoted = Array.isArray(myVotes) && myVotes.length>0;
        let timerEl = null;
        if (row.timer_end && !hasVoted) {
          timerEl = document.createElement("div");
          startCountdown(pollId, timerEl, new Date(row.timer_end).getTime(), row.timer_secs||parsed.timerSecs, ()=>{});
        }
        if (isFR) renderFRInput(bodyEl,pollId,hasVoted,timerEl);
        else      renderMCVoting(bodyEl,pollId,parsed.options,parsed.correctIndices,hasVoted,timerEl);
      } else if (status==="closed") {
        const opts = row.options ? JSON.parse(row.options) : parsed.options;
        const ci   = row.correct_indices ? JSON.parse(row.correct_indices) : parsed.correctIndices;
        if (isFR) await renderFRResults(bodyEl,pollId,row.correct_answer||"");
        else      await renderMCResults(bodyEl,pollId,opts,ci);
      } else {
        renderWaiting(bodyEl);
      }

      // Realtime updates
      if (activeSockets[pollId]) { try { activeSockets[pollId].close(); } catch(e){} }
      activeSockets[pollId] = sb.realtime("poll_sessions", async (event, record) => {
        if (!record || record.poll_id !== pollId) return;
        if (record.status==="open") {
          const myVotes  = await sb.select("poll_votes",`poll_id=eq.${pollId}&voter_name=eq.${encodeURIComponent(userName)}`);
          const hasVoted = Array.isArray(myVotes) && myVotes.length>0;
          let timerEl = null;
          if (record.timer_end && !hasVoted) {
            timerEl = document.createElement("div");
            startCountdown(pollId,timerEl,new Date(record.timer_end).getTime(),record.timer_secs||parsed.timerSecs,()=>{});
          } else { stopCountdown(pollId); }
          const opts = record.options ? JSON.parse(record.options) : parsed.options;
          if (isFR) renderFRInput(bodyEl,pollId,hasVoted,timerEl);
          else      renderMCVoting(bodyEl,pollId,opts,parsed.correctIndices,hasVoted,timerEl);
        } else if (record.status==="closed") {
          stopCountdown(pollId);
          const opts = record.options ? JSON.parse(record.options) : parsed.options;
          const ci   = record.correct_indices ? JSON.parse(record.correct_indices) : parsed.correctIndices;
          if (isFR) await renderFRResults(bodyEl,pollId,record.correct_answer||"");
          else      await renderMCResults(bodyEl,pollId,opts,ci);
        }
      });
    }

    // ── BOOTSTRAP ────────────────────────────────────────────────────────────
    isAdmin = checkAdminSession();

    function initCurrentSlide() {
      const slide = deck.getCurrentSlide();
      if (!slide) return;
      slide.querySelectorAll(".poll,.freeresponse").forEach(el => initPollEl(el));
    }

    deck.on("ready",        initCurrentSlide);
    deck.on("slidechanged", initCurrentSlide);
    if (isAdmin) setTimeout(initCurrentSlide, 200);
  }
};