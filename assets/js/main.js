(function () {
  "use strict";

  const { formatCount, setAllCounters, setCount } = window.MedHelixCounter;

/* --------------------------------------------------------------------------
   Environment helpers
   -------------------------------------------------------------------------- */

const BASE_COUNT = 0;
const COHORT_CAPACITY = 1500;
const STORAGE_KEY = "medhelix.waitlist.v1";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const fineQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
const prefersReduced = () => reduceQuery.matches;
const hasFinePointer = () => fineQuery.matches;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

/* --------------------------------------------------------------------------
   Waitlist store (local demo — no backend)
   -------------------------------------------------------------------------- */

function readStore() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    if (!Number.isFinite(data.position) || !data.email) return null;
    return {
      email: String(data.email),
      role: String(data.role || "Student"),
      position: Number(data.position),
      count: Number.isFinite(data.count) ? Number(data.count) : Number(data.position),
      code: String(data.code || makeCode(String(data.email))),
    };
  } catch (error) {
    return null;
  }
}

function writeStore(data) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    /* Storage can be blocked in preview sandboxes; in-memory state still works. */
  }
}

function makeCode(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `MHLX-${hash.toString(36).toUpperCase().padStart(5, "0").slice(-5)}`;
}

let membership = readStore();
let waitlistCount = membership ? membership.count : BASE_COUNT;
const simulateError = new URLSearchParams(window.location.search).get("simulate") === "error";
let simulatedFailurePending = simulateError;

function publishCount(count, animate = true) {
  waitlistCount = count;
  setAllCounters(count, animate);
  window.dispatchEvent(new CustomEvent("medhelix:count", { detail: { count, animate } }));
  renderCohort(animate);
}

/* --------------------------------------------------------------------------
   Cohort meter
   -------------------------------------------------------------------------- */

const cohortFill = $("[data-cohort-fill]");
const cohortTrack = $(".cohort-track");
let cohortRevealed = false;

function syncCohortMeta() {
  if (cohortTrack) {
    cohortTrack.setAttribute("aria-valuenow", String(waitlistCount));
    cohortTrack.setAttribute("aria-valuetext", `${formatCount(waitlistCount)} of ${formatCount(COHORT_CAPACITY)} founding places filled`);
  }
}

function renderCohort(animate = true) {
  if (!cohortFill) return;
  const ratio = clamp(waitlistCount / COHORT_CAPACITY, 0, 1);
  if (!animate || prefersReduced()) {
    cohortFill.style.transition = "none";
    cohortFill.style.setProperty("--p", String(ratio));
    void cohortFill.offsetWidth;
    cohortFill.style.transition = "";
  } else {
    cohortFill.style.setProperty("--p", String(ratio));
  }
  syncCohortMeta();
}

/* --------------------------------------------------------------------------
   Forms
   -------------------------------------------------------------------------- */

function buildFormUI(config) {
  const form = $(config.form);
  if (!form) return null;
  return {
    kind: config.kind,
    form,
    email: $(config.email, form),
    error: $(config.error, form),
    status: $(config.status, form),
    success: $(config.success),
    button: $('button[type="submit"]', form),
    label: $(".btn-label", form),
    successTitle: config.successTitle ? $(config.successTitle) : null,
  };
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateEmail(ui) {
  const value = ui.email.value.trim();
  if (!value) {
    return "Enter your email address so we can send your access link.";
  }
  if (!emailPattern.test(value)) {
    return "That email doesn't look right. Check for a typo — like a missing @ or a stray space.";
  }
  return "";
}

function showFieldError(ui, message) {
  ui.email.setAttribute("aria-invalid", "true");
  if (ui.error) {
    ui.error.textContent = message;
    ui.error.hidden = false;
  }
}

function clearFieldError(ui) {
  ui.email.removeAttribute("aria-invalid");
  if (ui.error) {
    ui.error.hidden = true;
    ui.error.textContent = "";
  }
}

function setLoading(ui, loading) {
  if (!ui.button) return;
  ui.button.disabled = loading;
  ui.button.classList.toggle("is-loading", loading);
  ui.button.setAttribute("aria-busy", String(loading));
  if (ui.label) ui.label.textContent = loading ? "Joining…" : "Join the waitlist";
}

function showFormError(ui) {
  if (!ui.status) return;
  ui.status.textContent = "";
  const alert = document.createElement("div");
  alert.className = "form-alert";
  const message = document.createElement("span");
  message.textContent = "That didn't go through. Check your connection and try again.";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "btn-link";
  retry.textContent = "Try again";
  retry.addEventListener("click", () => {
    ui.status.textContent = "";
    submitForm(ui);
  });
  alert.append(message, retry);
  ui.status.append(alert);
}

function applySuccess(ui, options = {}) {
  if (!ui) return;
  const { focus = false, celebrate = false } = options;
  const position = membership ? membership.position : BASE_COUNT + 1;
  const origin = ui.button ? ui.button.getBoundingClientRect() : null;

  $$("[data-position]").forEach((element) => {
    element.textContent = `#${formatCount(position)}`;
  });

  if (ui.form) ui.form.hidden = true;
  if (ui.success) ui.success.hidden = false;
  if (ui.error) ui.error.hidden = true;

  if (membership) {
    const refInput = $("#ref-link");
    if (refInput) {
      refInput.value = `https://medhelixapp.com/?ref=${membership.code}`;
    }
  }

  if (focus) {
    const target = ui.successTitle || ui.success;
    if (target) {
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      window.setTimeout(() => target.focus({ preventScroll: true }), 80);
    }
  }

  if (celebrate && origin && origin.width > 0) burst(origin);
}

function completeJoin(ui, email, role, customData = null) {
  const currentCount = waitlistCount + 1;
  membership = customData || {
    email,
    role,
    position: currentCount,
    count: currentCount,
    code: makeCode(`${email}${currentCount}`),
  };
  writeStore(membership);
  publishCount(membership.count, true);
  const fromWaitlist = ui === waitlistUI;
  applySuccess(heroUI, { focus: !fromWaitlist, celebrate: !fromWaitlist });
  applySuccess(waitlistUI, { focus: fromWaitlist, celebrate: fromWaitlist });
  if (waitlistUI && waitlistUI.form) {
    const roleInput = waitlistUI.form.querySelector(`input[name="role"][value="${role}"]`);
    if (roleInput) roleInput.checked = true;
  }
  if (ui === waitlistUI) {
    /* The hero status lives outside the hidden form; keep it honest too. */
    const heroSuccess = $("#hero-success");
    if (heroSuccess) heroSuccess.hidden = false;
  }
}

async function submitForm(ui) {
  if (!ui || !ui.email) return;
  if (ui.button && ui.button.disabled) return;

  const message = validateEmail(ui);
  if (message) {
    showFieldError(ui, message);
    ui.email.focus();
    return;
  }
  clearFieldError(ui);
  if (ui.status) ui.status.textContent = "";
  setLoading(ui, true);

  const roleInput = ui.form.querySelector('input[name="role"]:checked');
  const role = roleInput ? roleInput.value : "Student";
  const email = ui.email.value.trim();

  // Check for custom backend endpoint if configured
  const endpointMeta = $('meta[name="medhelix-waitlist-endpoint"]');
  const endpoint = endpointMeta ? endpointMeta.getAttribute("content")?.trim() : "";

  if (endpoint) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          role,
          source: ui.kind,
          page: window.location.pathname,
        }),
      });
      if (!response.ok) throw new Error("Network response error");
      const result = await response.json();
      setLoading(ui, false);
      completeJoin(ui, email, role, {
        email,
        role,
        position: Number(result.position) || BASE_COUNT + 1,
        count: Number(result.count) || Number(result.position) || BASE_COUNT + 1,
        code: String(result.code || makeCode(`${email}${BASE_COUNT + 1}`)),
      });
      return;
    } catch (apiError) {
      setLoading(ui, false);
      showFormError(ui);
      return;
    }
  }

  // Simulated latency for demo
  await wait(900);

  let failed = !navigator.onLine;
  if (simulatedFailurePending) {
    failed = true;
    simulatedFailurePending = false;
  }

  if (failed) {
    setLoading(ui, false);
    showFormError(ui);
    return;
  }

  setLoading(ui, false);
  completeJoin(ui, email, role);
}

const heroUI = buildFormUI({
  kind: "hero",
  form: "#hero-form",
  email: "#hero-email",
  error: "#hero-email-error",
  status: "#hero-form-status",
  success: "#hero-success",
});

const waitlistUI = buildFormUI({
  kind: "waitlist",
  form: "#waitlist-form",
  email: "#waitlist-email",
  error: "#waitlist-email-error",
  status: "#waitlist-form-status",
  success: "#waitlist-success",
  successTitle: ".success-title",
});

[heroUI, waitlistUI].forEach((ui) => {
  if (!ui) return;
  ui.form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitForm(ui);
  });
  ui.email.addEventListener("blur", () => {
    if (ui.email.value.trim() === "") return;
    const message = validateEmail(ui);
    if (message) showFieldError(ui, message);
    else clearFieldError(ui);
  });
  ui.email.addEventListener("input", () => {
    if (ui.email.getAttribute("aria-invalid") !== "true") return;
    if (!validateEmail(ui)) clearFieldError(ui);
  });
});

const copyButton = $("[data-copy-ref]");
const refInput = $("#ref-link");
const copyFeedback = $("[data-copy-feedback]");

if (copyButton && refInput) {
  copyButton.addEventListener("click", async () => {
    const value = refInput.value;
    let copied = false;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch (error) {
      refInput.focus();
      refInput.select();
      refInput.setSelectionRange(0, value.length);
      try {
        copied = document.execCommand("copy");
      } catch (fallbackError) {
        copied = false;
      }
    }
    if (copyFeedback) {
      copyFeedback.textContent = copied
        ? "Link copied. Send it to a colleague."
        : "Copy didn't work — select the link and copy it manually.";
      copyFeedback.style.color = copied ? "" : "#F0F0F0";
    }
    if (copied) {
      const original = copyButton.textContent;
      copyButton.textContent = "Copied";
      window.setTimeout(() => {
        copyButton.textContent = original;
      }, 1800);
    }
  });
}

/* --------------------------------------------------------------------------
   Confetti (palette only, transform + opacity, skipped on reduced motion)
   -------------------------------------------------------------------------- */

function burst(rect) {
  if (prefersReduced()) return;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const colors = ["#E38B60", "#D9785C", "#E6DFD3", "#F0F0F0", "#111111"];
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  document.body.append(layer);

  for (let i = 0; i < 28; i += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti";
    piece.style.background = colors[i % colors.length];
    const width = 6 + Math.random() * 5;
    piece.style.width = `${width}px`;
    piece.style.height = `${width * 1.6}px`;
    layer.append(piece);

    const angle = Math.random() * Math.PI * 2;
    const distance = 90 + Math.random() * 180;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance - 70;
    const rotation = Math.random() * 520 - 260;
    const animation = piece.animate(
      [
        { transform: `translate3d(${cx}px, ${cy}px, 0) rotate(0deg)`, opacity: 1 },
        {
          transform: `translate3d(${cx + dx}px, ${cy + dy + distance * 0.5}px, 0) rotate(${rotation}deg)`,
          opacity: 0,
        },
      ],
      {
        duration: 900 + Math.random() * 500,
        delay: Math.random() * 90,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "forwards",
      }
    );
    animation.onfinish = () => piece.remove();
  }

  window.setTimeout(() => layer.remove(), 1800);
}

/* --------------------------------------------------------------------------
   Sticky case walkthrough
   -------------------------------------------------------------------------- */

const stepEls = $$("[data-step]");
const paneEls = $$("[data-pane]");
let activeStep = 0;

stepEls.forEach((step, i) => {
  step.addEventListener("click", () => {
    setStep(i);
  });
});

function setStep(index) {
  if (index === activeStep) return;
  activeStep = index;
  stepEls.forEach((step, i) => step.classList.toggle("is-active", i === index));
  paneEls.forEach((pane, i) => {
    pane.classList.toggle("is-active", i === index);
    pane.setAttribute("aria-hidden", String(i !== index));
  });
}

function updateSteps() {
  if (!stepEls.length) return;
  const compactLayout = window.innerWidth < 900;
  const marker = window.innerHeight * (compactLayout ? 0.62 : 0.54);
  let index = 0;
  stepEls.forEach((step, i) => {
    if (step.getBoundingClientRect().top <= marker) index = i;
  });
  setStep(index);
}

/* --------------------------------------------------------------------------
   Scroll-driven reveal, count-up and sticky steps
   -------------------------------------------------------------------------- */

let scrollTicking = false;

function onScroll() {
  if (scrollTicking) return;
  scrollTicking = true;
  window.requestAnimationFrame(() => {
    scrollTicking = false;
    updateSteps();
  });
}

window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onScroll, { passive: true });

const revealTargets = $$("[data-reveal], .reveal-group, .rule-wipe, .waitlist, .hero");
const seen = new WeakSet();

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        if (seen.has(entry.target)) return;
        seen.add(entry.target);
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
  );
  revealTargets.forEach((element) => observer.observe(element));

  const proof = $(".proof");
  if (proof) {
    const proofObserver = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        proofObserver.disconnect();
        const counter = $("[data-countup]");
        if (counter) countUp(counter, waitlistCount);
      },
      { threshold: 0.35 }
    );
    proofObserver.observe(proof);
  }

  const cohortSection = $("#waitlist");
  if (cohortSection && !cohortRevealed) {
    const cohortObserver = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        cohortObserver.disconnect();
        if (!cohortRevealed) {
          renderCohort(true);
          cohortRevealed = true;
        }
      },
      { threshold: 0.2 }
    );
    cohortObserver.observe(cohortSection);
  }
} else {
  revealTargets.forEach((element) => element.classList.add("is-in"));
  const counter = $("[data-countup]");
  if (counter) setCount(counter, waitlistCount, false);
  renderCohort(true);
  cohortRevealed = true;
}

function countUp(element, target) {
  if (prefersReduced()) {
    setCount(element, target, false);
    return;
  }
  const duration = 1500;
  const start = performance.now();
  const from = 0;
  const to = Math.max(0, Math.round(target));

  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    setCount(element, Math.round(from + (to - from) * eased), false);
    if (t < 1) window.requestAnimationFrame(frame);
    else setCount(element, to, false);
  }
  window.requestAnimationFrame(frame);
}

/* --------------------------------------------------------------------------
   Hero case stack: pointer parallax + soft tilt
   -------------------------------------------------------------------------- */

const hero = $(".hero");
const stack = $("[data-stack]");
const cards = $$(".case-card");

if (hero && stack && cards.length) {
  hero.addEventListener("pointermove", (event) => {
    if (!hasFinePointer() || prefersReduced()) return;
    const rect = stack.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const nx = clamp((event.clientX - centerX) / (Math.max(rect.width, 360) * 1.2), -0.6, 0.6) * 1.8;
    const ny = clamp((event.clientY - centerY) / (Math.max(rect.height, 360) * 1.2), -0.6, 0.6) * 1.8;
    cards.forEach((card) => {
      const depth = Number(card.dataset.depth) || 1;
      card.style.setProperty("--px", `${nx * 12 * depth}px`);
      card.style.setProperty("--py", `${ny * 10 * depth}px`);
    });
  });

  hero.addEventListener("pointerleave", () => {
    cards.forEach((card) => {
      card.style.setProperty("--px", "0px");
      card.style.setProperty("--py", "0px");
      card.style.setProperty("--tx", "0deg");
      card.style.setProperty("--ty", "0deg");
      card.classList.remove("is-tilting");
    });
  });

  cards.forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      if (!hasFinePointer() || prefersReduced()) return;
      const rect = card.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      card.style.setProperty("--ty", `${(px - 0.5) * 7}deg`);
      card.style.setProperty("--tx", `${(0.5 - py) * 7}deg`);
      card.classList.add("is-tilting");
    });
    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--tx", "0deg");
      card.style.setProperty("--ty", "0deg");
      card.classList.remove("is-tilting");
    });
  });
}

/* --------------------------------------------------------------------------
   Bento tilt
   -------------------------------------------------------------------------- */

$$("[data-tilt]").forEach((tile) => {
  tile.addEventListener("pointermove", (event) => {
    if (!hasFinePointer() || prefersReduced()) return;
    const rect = tile.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    tile.style.setProperty("--ry", `${(px - 0.5) * 9}deg`);
    tile.style.setProperty("--rx", `${(0.5 - py) * 9}deg`);
    tile.style.setProperty("--lift", "-2px");
    tile.style.setProperty("--gx", `${px * 100}%`);
    tile.style.setProperty("--gy", `${py * 100}%`);
    tile.classList.add("is-pointing");
  });

  tile.addEventListener("pointerleave", () => {
    tile.classList.remove("is-pointing");
    tile.style.setProperty("--rx", "0deg");
    tile.style.setProperty("--ry", "0deg");
    tile.style.setProperty("--lift", "0px");
  });
});

/* --------------------------------------------------------------------------
   Magnetic buttons
   -------------------------------------------------------------------------- */

$$("[data-magnetic]").forEach((button) => {
  button.addEventListener("pointermove", (event) => {
    if (!hasFinePointer() || prefersReduced()) return;
    const rect = button.getBoundingClientRect();
    const dx = clamp(((event.clientX - rect.left) / rect.width - 0.5) * 16, -8, 8);
    const dy = clamp(((event.clientY - rect.top) / rect.height - 0.5) * 12, -6, 6);
    button.style.setProperty("--mx", `${dx}px`);
    button.style.setProperty("--my", `${dy}px`);
    button.classList.add("is-magnet");
  });

  button.addEventListener("pointerleave", () => {
    button.classList.remove("is-magnet");
    button.style.setProperty("--mx", "0px");
    button.style.setProperty("--my", "0px");
  });
});

/* --------------------------------------------------------------------------
   Interactive mini case
   -------------------------------------------------------------------------- */

const monitor = $("[data-monitor]");
const demoOptions = $$(".option");
const demoReset = $("[data-demo-reset]");
const demoStatus = $("[data-demo-status]");
const demoFeedback = $("[data-demo-feedback]");

const demoInitial = {
  hr: "104",
  bp: "132/84",
  spo2: "96",
  status: "Stable · awaiting your decision",
  feedback: "Choose an action to see how the patient responds.",
  tone: "ok",
  unstable: false,
};

const demoOutcomes = {
  ecg: {
    hr: "104",
    bp: "132/84",
    spo2: "96",
    status: "ECG ordered · S1Q3T3 pattern seen",
    feedback:
      "Good call. The ECG shows sinus tachycardia with an S1Q3T3 pattern — enough to take PE seriously. Next you'd risk-stratify and start treatment.",
    tone: "ok",
    unstable: false,
  },
  fluids: {
    hr: "116",
    bp: "122/76",
    spo2: "94",
    status: "Fluids given · no improvement",
    feedback:
      "She is no better. A fluid bolus is not the answer here and can worsen right-heart strain. Reconsider the diagnosis and look at the ECG.",
    tone: "warn",
    unstable: true,
  },
  discharge: {
    hr: "126",
    bp: "106/68",
    spo2: "92",
    status: "Discharged · patient deteriorates",
    feedback:
      "She returns 40 minutes later, more breathless. A missed PE can be fatal. The ECG was the safer first step.",
    tone: "warn",
    unstable: true,
  },
};

function setVital(name, value) {
  const element = $(`[data-vital="${name}"]`);
  if (!element || element.textContent === value) return;
  element.textContent = value;
  element.classList.add("is-bump");
  window.setTimeout(() => element.classList.remove("is-bump"), 650);
}

function applyDemoState(state) {
  if (!monitor) return;
  setVital("hr", state.hr);
  setVital("bp", state.bp);
  setVital("spo2", state.spo2);
  if (demoStatus) {
    demoStatus.textContent = state.status;
    demoStatus.setAttribute("data-tone", state.tone);
  }
  if (demoFeedback) demoFeedback.textContent = state.feedback;
  monitor.classList.toggle("is-unstable", Boolean(state.unstable));
}

function resetDemo() {
  demoOptions.forEach((option) => {
    option.disabled = false;
    option.classList.remove("is-pick", "is-correct");
  });
  if (demoReset) demoReset.hidden = true;
  applyDemoState(demoInitial);
}

demoOptions.forEach((option) => {
  option.addEventListener("click", () => {
    if (option.disabled) return;
    const outcome = demoOutcomes[option.dataset.answer];
    if (!outcome) return;
    demoOptions.forEach((item) => {
      item.disabled = true;
    });
    option.classList.add("is-pick");
    if (option.dataset.answer === "ecg") option.classList.add("is-correct");
    applyDemoState(outcome);
    if (demoReset) demoReset.hidden = false;
  });
});

if (demoReset) demoReset.addEventListener("click", resetDemo);

/* --------------------------------------------------------------------------
   FAQ accordion
   -------------------------------------------------------------------------- */

$$(".faq-item").forEach((item) => {
  const button = $(".faq-q", item);
  const panel = $(".faq-a", item);
  if (!button || !panel) return;
  panel.inert = true;

  button.addEventListener("click", () => {
    const open = !item.classList.contains("is-open");
    item.classList.toggle("is-open", open);
    button.setAttribute("aria-expanded", String(open));
    panel.inert = !open;
  });

  item.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!item.classList.contains("is-open")) return;
    item.classList.remove("is-open");
    button.setAttribute("aria-expanded", "false");
    panel.inert = true;
    button.focus();
  });
});

/* --------------------------------------------------------------------------
   Custom cursor (desktop only, decorative)
   -------------------------------------------------------------------------- */

if (hasFinePointer() && !prefersReduced()) {
  const ring = document.createElement("div");
  ring.className = "cursor-ring";
  ring.setAttribute("aria-hidden", "true");
  document.body.append(ring);

  let pointerX = -100;
  let pointerY = -100;
  let currentX = -100;
  let currentY = -100;
  let cursorStarted = false;

  window.addEventListener(
    "pointermove",
    (event) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (!cursorStarted) {
        cursorStarted = true;
        currentX = pointerX;
        currentY = pointerY;
        document.body.classList.add("cursor-ready");
      }
    },
    { passive: true }
  );

  window.addEventListener(
    "wheel",
    (event) => {
      // Re-evaluate target under cursor during scroll
      if (cursorStarted) {
        const el = document.elementFromPoint(pointerX, pointerY);
        if (el) {
          const interactive = el.closest("a, button, input, select, textarea, [data-cursor]");
          ring.classList.toggle("is-active", Boolean(interactive));
          ring.classList.toggle("is-on-dark", Boolean(el.closest(".waitlist, .island")));
        }
      }
    },
    { passive: true }
  );

  document.addEventListener("pointerleave", () => {
    ring.style.opacity = "0";
  });

  document.addEventListener("pointerenter", () => {
    if (cursorStarted) ring.style.opacity = "1";
  });

  document.addEventListener("pointerover", (event) => {
    const interactive = event.target.closest("a, button, input, select, textarea, [data-cursor]");
    ring.classList.toggle("is-active", Boolean(interactive));
    ring.classList.toggle("is-on-dark", Boolean(event.target.closest(".waitlist, .island")));
  });

  (function follow() {
    currentX += (pointerX - currentX) * 0.18;
    currentY += (pointerY - currentY) * 0.18;
    ring.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) translate(-50%, -50%)`;
    window.requestAnimationFrame(follow);
  })();
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

async function fetchLiveCount() {
  try {
    const res = await fetch("/api/waitlist");
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.count === "number") {
        publishCount(data.count, false);
      }
    }
  } catch (e) {
    // Keep local fallback
  }
}

function boot() {
  setAllCounters(waitlistCount, false);
  if (cohortFill) cohortFill.style.setProperty("--p", "0");

  hero?.classList.add("is-in");
  updateSteps();

  if (membership) {
    applySuccess(heroUI, {});
    applySuccess(waitlistUI, {});
    publishCount(membership.count, false);
    cohortRevealed = true;
  } else {
    syncCohortMeta();
    if (cohortFill) cohortFill.style.setProperty("--p", "0");
    fetchLiveCount();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}

})();
