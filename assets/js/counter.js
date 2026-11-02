/**
 * Digit counter with an odometer-style roll when a value changes.
 * Shared by the island nav, the proof strip and the waitlist cohort meter.
 */

(function () {
  "use strict";

  const numberFormat = new Intl.NumberFormat("en-US");

function formatCount(value) {
  return numberFormat.format(Math.max(0, Math.round(Number(value) || 0)));
}

function readCount(element) {
  const raw = (element.getAttribute("data-value") || element.textContent || "").replace(/[^\d]/g, "");
  return raw ? Number(raw) : 0;
}

function build(element, value) {
  const text = formatCount(value);
  const visual = document.createElement("span");
  visual.className = "counter-visual";
  visual.setAttribute("aria-hidden", "true");
  const fragment = document.createDocumentFragment();
  const parts = [];

  Array.from(text).forEach((char) => {
    if (/\d/.test(char)) {
      const digit = document.createElement("span");
      digit.className = "dg";
      const current = document.createElement("span");
      current.className = "dg-old";
      current.textContent = char;
      const next = document.createElement("span");
      next.className = "dg-new";
      next.textContent = char;
      digit.append(current, next);
      fragment.append(digit);
      parts.push({ char, node: digit, current, next, digit: true });
    } else {
      const separator = document.createElement("span");
      separator.className = "sep";
      separator.textContent = char;
      fragment.append(separator);
      parts.push({ char, node: separator, digit: false });
    }
  });

  visual.append(fragment);
  element.textContent = "";
  if (!element._counterSr) {
    element._counterSr = document.createElement("span");
    element._counterSr.className = "sr-only";
  }
  element._counterSr.textContent = text;
  element.append(element._counterSr, visual);
  element.dataset.value = String(value);
  element._counterParts = parts;
}

function roll(element, value) {
  const text = formatCount(value);
  const parts = element._counterParts;
  if (!parts) {
    build(element, value);
    return;
  }
  if (text.length !== parts.length) {
    build(element, value);
    return;
  }

  Array.from(text).forEach((char, index) => {
    const part = parts[index];
    if (!part || !part.digit) return;
    if (part.char === char) return;
    part.char = char;
    part.next.textContent = char;
    part.node.classList.add("is-rolling");
    window.setTimeout(() => {
      part.current.textContent = char;
      part.node.classList.remove("is-rolling");
    }, 460);
  });

  if (element._counterSr) element._counterSr.textContent = text;
  element.dataset.value = String(value);
}

function setCount(element, value, animate = true) {
  if (!element) return;
  if (!element._counterParts) {
    build(element, value);
    return;
  }
  if (element.dataset.value === String(value)) return;
  if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    build(element, value);
    return;
  }
  roll(element, value);
}

function setAllCounters(value, animate = true) {
  document.querySelectorAll("[data-waitlist-count]").forEach((element) => {
    setCount(element, value, animate);
  });
}

function initCounters() {
  document.querySelectorAll("[data-waitlist-count]").forEach((element) => {
    if (!element._counterParts) build(element, readCount(element));
  });
}

  window.MedHelixCounter = {
    formatCount,
    readCount,
    setCount,
    setAllCounters,
    initCounters,
  };
})();
