/**
 * MedHelix floating island navigation.
 *
 * Reusable component: place the island markup in the document, then either
 * mount it with new NavIsland(el), or let this file auto-mount the element with
 * [data-island]. Public API: island.setCount(n), island.expand(),
 * island.closeMenu(). Emits nothing; listens for the "medhelix:count" event.
 */

(function () {
  "use strict";

  const { initCounters, setAllCounters } = window.MedHelixCounter;

const COMPACT_AFTER = 120;
const DIRECTION_DELTA = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * 9;

class NavIsland {
  constructor(root) {
    this.root = root;
    this.bar = root.querySelector(".island-bar");
    this.linksWrap = root.querySelector(".island-links");
    this.highlight = root.querySelector(".island-hl");
    this.linkEls = Array.from(root.querySelectorAll(".island-links a[data-nav]"));
    this.compactLabel = root.querySelector("[data-compact-label]");
    this.compactButton = root.querySelector(".island-compact");
    this.ring = root.querySelector("[data-progress-ring]");
    this.menuButton = root.querySelector(".island-menu");
    this.sheet = root.querySelector(".island-sheet");
    this.backdrop = root.querySelector("[data-island-backdrop]");
    this.sheetLinks = Array.from(root.querySelectorAll(".island-sheet a"));
    this.sections = Array.from(document.querySelectorAll("[data-section]"));

    this.lastY = window.scrollY;
    this.activeId = null;
    this.isMobile = window.matchMedia("(max-width: 767px)").matches;
    this.sheetOpen = false;
    this.ticking = false;
    this.hovered = null;

    initCounters();
    this.bind();
    this.updateScrollState();
    this.tick();

    window.setTimeout(() => this.root.classList.add("is-mounted"), 90);

    if (this.sheet) {
      this.sheet.inert = true;
      this.sheet.setAttribute("aria-hidden", "true");
    }
    if (this.compactButton) {
      this.compactButton.setAttribute("aria-expanded", "false");
    }
    this.setCompact(false);
    this.updateActive(this.activeSectionFor(window.scrollY));
  }

  bind() {
    window.addEventListener("scroll", () => this.schedule(), { passive: true });
    window.addEventListener("resize", () => this.onResize(), { passive: true });
    window.addEventListener("medhelix:count", (event) => {
      if (event.detail && Number.isFinite(event.detail.count)) {
        setAllCounters(event.detail.count, event.detail.animate !== false);
      }
    });

    this.linkEls.forEach((link) => {
      link.addEventListener("pointerenter", () => {
        this.hovered = link;
        this.moveHighlight(link);
      });
      link.addEventListener("focus", () => {
        this.hovered = link;
        this.moveHighlight(link);
      });
      link.addEventListener("click", () => this.closeMenu());
      link.addEventListener("blur", () => {
        this.hovered = null;
        this.moveHighlight(this.activeLink());
      });
    });

    if (this.linksWrap) {
      this.linksWrap.addEventListener("pointerleave", () => {
        this.hovered = null;
        this.moveHighlight(this.activeLink());
      });
    }

    this.root.addEventListener("focusin", (event) => {
      if (!this.root.classList.contains("is-compact") || this.isMobile) return;
      if (event.target === this.compactButton) return;
      this.expand();
    });

    if (this.compactButton) {
      this.compactButton.addEventListener("click", () => this.expand(true));
    }

    if (this.menuButton) {
      this.menuButton.addEventListener("click", () => this.toggleMenu());
    }

    if (this.backdrop) {
      this.backdrop.addEventListener("click", () => this.closeMenu());
    }

    this.sheetLinks.forEach((link) => {
      link.addEventListener("click", () => this.closeMenu());
    });

    document.addEventListener("pointerdown", (event) => {
      if (this.sheetOpen && !this.root.contains(event.target)) this.closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.sheetOpen) {
        this.closeMenu(true);
      }
    });

    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = () => {
      this.isMobile = mq.matches;
      this.closeMenu();
      this.setCompact(false);
      this.lastY = window.scrollY;
      this.schedule();
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => this.moveHighlight(this.hovered || this.activeLink()));
    }
  }

  schedule() {
    if (this.ticking) return;
    this.ticking = true;
    window.requestAnimationFrame(() => {
      this.ticking = false;
      this.tick();
    });
  }

  tick() {
    const y = window.scrollY || document.documentElement.scrollTop;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const progress = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;

    if (this.ring) {
      this.ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
    }

    this.updateActive(this.activeSectionFor(y));

    if (!this.isMobile && !this.sheetOpen) {
      const delta = y - this.lastY;
      const focusInIsland = this.root.contains(document.activeElement);
      if (y < COMPACT_AFTER) {
        if (!focusInIsland) this.setCompact(false);
      } else if (delta > DIRECTION_DELTA && y > COMPACT_AFTER) {
        if (!focusInIsland) this.setCompact(true);
      } else if (delta < -DIRECTION_DELTA) {
        this.setCompact(false);
      }
    }

    this.lastY = y;
  }

  updateScrollState() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    if (this.ring) {
      this.ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
    }
  }

  activeSectionFor(y) {
    if (!this.sections.length) return null;
    const marker = window.innerHeight * 0.42;
    let current = this.sections[0];
    for (const section of this.sections) {
      const rect = section.getBoundingClientRect();
      if (rect.top <= marker) current = section;
      else break;
    }
    if (y + window.innerHeight >= document.documentElement.scrollHeight - 4) {
      current = this.sections[this.sections.length - 1];
    }
    return current;
  }

  activeSection() {
    return this.sections.find((section) => section.dataset.section === this.activeId) || this.sections[0];
  }

  updateActive(section) {
    if (!section) return;
    const nextId = section.dataset.section;
    if (this.compactLabel && section.dataset.label) {
      this.compactLabel.textContent = section.dataset.label;
    }
    if (nextId === this.activeId) return;

    this.activeId = nextId;
    this.linkEls.forEach((link) => {
      if (link.dataset.nav === nextId) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });

    if (!this.hovered) this.moveHighlight(this.activeLink(), true);
  }

  activeLink() {
    return this.linkEls.find((link) => link.dataset.nav === this.activeId) || null;
  }

  moveHighlight(link, immediate = false) {
    if (!this.highlight || !link) {
      if (this.highlight) this.highlight.style.setProperty("--hl-o", "0");
      return;
    }
    if (immediate) {
      this.highlight.style.transition = "none";
    }
    this.highlight.style.setProperty("--hl-x", `${link.offsetLeft}px`);
    this.highlight.style.setProperty("--hl-w", `${link.offsetWidth}px`);
    this.highlight.style.setProperty("--hl-o", "1");
    if (immediate) {
      void this.highlight.offsetWidth;
      this.highlight.style.transition = "";
    }
  }

  setCompact(compact) {
    if (this.isMobile) compact = false;
    const changed = this.root.classList.contains("is-compact") !== compact;
    this.root.classList.toggle("is-compact", compact);
    if (this.compactButton) {
      this.compactButton.setAttribute("aria-expanded", String(!compact));
    }
    if (changed && !compact) {
      this.moveHighlight(this.hovered || this.activeLink(), true);
    }
  }

  expand(focusFirst = false) {
    this.setCompact(false);
    if (focusFirst) {
      const target = this.activeLink() || this.linkEls[0];
      if (target) window.setTimeout(() => target.focus(), 60);
    }
  }

  toggleMenu() {
    this.setSheet(!this.sheetOpen);
  }

  setSheet(open) {
    if (!this.sheet || !this.menuButton) return;
    this.sheetOpen = open;
    this.root.classList.toggle("is-open", open);
    document.body.classList.toggle("sheet-open", open);
    this.menuButton.setAttribute("aria-expanded", String(open));
    this.menuButton.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    this.sheet.inert = !open;
    this.sheet.setAttribute("aria-hidden", String(!open));

    if (open) {
      const first = this.sheet.querySelector("a");
      if (first) window.setTimeout(() => first.focus({ preventScroll: true }), 180);
    }
  }

  closeMenu(returnFocus = false) {
    if (!this.sheetOpen) return;
    this.setSheet(false);
    document.body.classList.remove("sheet-open");
    if (returnFocus && this.menuButton) {
      this.menuButton.focus({ preventScroll: true });
    }
  }

  setCount(value, animate = true) {
    setAllCounters(value, animate);
  }

  onResize() {
    this.isMobile = window.matchMedia("(max-width: 767px)").matches;
    this.closeMenu();
    document.body.classList.remove("sheet-open");
    this.setCompact(false);
    this.moveHighlight(this.hovered || this.activeLink(), true);
    this.schedule();
  }
}

function mount() {
  const root = document.querySelector("[data-island]");
  if (!root) return;
  window.medhelixIsland = new NavIsland(root);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}


  window.NavIsland = NavIsland;
})();
