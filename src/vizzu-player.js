import VizzuController from "./vizzu-controller.js";

const LOG_PREFIX = [
  "%cVIZZU%cPLAYER",
  "background: #e2ae30; color: #3a60bf; font-weight: bold",
  "background: #3a60bf; color: #e2ae30;",
];

class VizzuPlayer extends HTMLElement {
  constructor() {
    super();

    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = this._render();

    this._resolveVizzu = null;
    this.initializing = new Promise((resolve) => {
      this._resolveVizzu = resolve;
    }).then(() => this.vizzu.initializing);
  }

  async connectedCallback() {
    await this._initVizzu();
    if (!this.hasAttribute("tabindex")) {
      this.setAttribute("tabindex", 0);
      this.tabIndex = 0;
    }
  }

  get debug() {
    const debugCookie = document.cookie
      .split(";")
      .some((c) => c.startsWith("vizzu-debug"));
    return debugCookie || this.hasAttribute("debug");
  }

  log(...msg) {
    if (this.debug) {
      console.log(...LOG_PREFIX, ...msg);
    }
  }

  get vizzuUrl() {
    return (
      this.getAttribute("vizzu-url") ||
      "https://cdn.jsdelivr.net/npm/vizzu@latest/dist/vizzu.min.js"
    );
  }

  async _initVizzu() {
    if (!this.vizzu) {
      // load and init vizzu
      const Vizzu = window.Vizzu || (await import(this.vizzuUrl)).default;
      this._resolveVizzu(Vizzu);
      this.vizzu = new Vizzu(this.vizzuCanvas);
    }
  }

  _slideToAnimparams(slide) {
    const animParams = [];

    if (slide._id) {
      // already got an ID
      animParams.push(slide._id);
    } else {
      const animTarget = {};
      if (slide.config) {
        animTarget.config = slide.config;
      }
      if (slide.style) {
        animTarget.style = slide.style;
      }
      if (slide.data) {
        animTarget.data = slide.data;
      }
      if (typeof slide.filter !== "undefined") {
        // null is valid
        if (!animTarget.data) {
          animTarget.data = {};
        }
        animTarget.data.filter = slide.filter;
      }

      animParams.push(animTarget);
    }

    if (slide.animOptions) {
      animParams.push(slide.animOptions);
    }

    return animParams;
  }

  async _convertSlides(slides) {
    if (slides?.slides?.length) {
      if (!Array.isArray(slides.slides[0])) {
        slides.slides[0] = [slides.slides[0]];
      }
      const firstSlide = slides.slides[0][0];
      firstSlide.data = firstSlide.data || Object.assign({}, slides.data);
      firstSlide.style = firstSlide.style || slides.style;
    }

    // TODO lock
    await this.vizzu.initializing;
    const seekToEnd = () => this._seekToEnd();
    this.vizzu.on("animation-begin", seekToEnd);
    this._nullSlide = this.vizzu.store();
    const convertedSlides = [];

    for (const slide of slides.slides) {
      let steps = slide;
      if (!Array.isArray(steps)) {
        steps = [steps];
      }

      const chartSteps = [];
      for (const step of steps) {
        const animParams = this._slideToAnimparams(step);
        await this.vizzu.animate(...animParams);
        animParams[0] = this.vizzu.store();
        chartSteps.push(animParams);
      }
      convertedSlides.push(chartSteps);
    }
    if (convertedSlides.length) {
      await this.vizzu.animate(...convertedSlides[0][0]);
    }
    this.vizzu.off("animation-begin", seekToEnd);

    return convertedSlides;
  }

  get slides() {
    return this._slides;
  }

  // TODO
  set slides(slides) {
    this._currentSlide = 0;
    this._setSlides(slides);
  }

  get _locked() {
    return this._lock;
  }

  set _locked(lock) {
    if (!lock) {
      this.removeAttribute("locked");
      clearTimeout(this._lock);
      this._lock = false;
    } else if (!this._lock) {
      this.setAttribute("locked", "");
      this._lock = lock;
    } else {
      this.log("!ALREADY LOCKED!");
    }
  }

  acquireLock(timeout = 1000) {
    if (this._locked) {
      this.log("lock already acquired");
      return false;
    }
    this.log("acquire lock");
    this._locked = setTimeout(() => {
      this._locked = false;
    }, timeout);
    return this._locked;
  }

  releaseLock() {
    this.log("release lock");
    this._locked = false;
  }

  async _setSlides(slides) {
    if (!this.acquireLock()) {
      return;
    }
    this.setAttribute("initializing", "");
    this._originalSlides = slides;
    this._slides = await this._convertSlides(slides);
    this.releaseLock();
    this.setSlide(this._currentSlide);
    this.removeAttribute("initializing");
  }

  get vizzuCanvas() {
    return this.shadowRoot.getElementById("vizzu");
  }

  get length() {
    return this._slides?.length || 0;
  }

  get currentSlide() {
    return this._currentSlide;
  }

  set currentSlide(slide) {
    this.setSlide(slide);
  }

  get slide() {
    return this._slides?.[this._currentSlide];
  }

  get _includeController() {
    return this.hasAttribute("controller");
  }

  // TODO
  async _step(step) {
    return await this.vizzu.animate(...step);
  }

  // TODO proper exception handling to re-enable rendering and such
  async _jump(cs, ss, percent) {
    return new Promise((resolve) =>
      setTimeout(async () => {
        this.log("jump to", cs, ss, percent);
        const subSlide = this._slides[cs][ss];
        const seek = () => this._seekTo(percent);

        this.vizzu.feature("rendering", false);
        // animate to previous slide
        if (ss > 0) {
          const prevSubSlide = this._slides[cs][ss - 1];
          const seekToEnd = () => this._seekToEnd();
          this.vizzu.on("animation-begin", seekToEnd);
          await this.vizzu.animate(...prevSubSlide);
          this.vizzu.off("animation-begin", seekToEnd);
        } else if (cs > 0) {
          const prevSlide = this._slides[cs - 1];
          const prevSubSlide = prevSlide[prevSlide.length - 1];
          const seekToEnd = () => this._seekToEnd();
          this.vizzu.on("animation-begin", seekToEnd);
          await this.vizzu.animate(...prevSubSlide);
          this.vizzu.off("animation-begin", seekToEnd);
        }
        this.vizzu.feature("rendering", true);

        // jump to subSlide
        this.vizzu.on("animation-begin", seek);
        await this.vizzu.animate(...subSlide);
        this.vizzu.off("animation-begin", seek);

        resolve(this.vizzu);
      }, 0)
    );
  }

  async _seekTo(percent) {
    return new Promise((resolve) =>
      setTimeout(() => {
        this.vizzu.animation.seek(`${percent}%`);
        resolve(this.vizzu);
      }, 0)
    );
  }

  async _seekToStart() {
    return this._seekTo(0);
  }

  async _seekToEnd() {
    return this._seekTo(100);
  }

  async setSlide(slide, subSlide) {
    if (this.length === 0 || !this.acquireLock()) {
      return;
    }
    this._update(this._state);

    if (!slide || slide < 0) {
      slide = 0;
    } else if (slide >= this.length) {
      slide = this.length - 1;
    }

    if (typeof subSlide !== "undefined") {
      this._subSlide = subSlide;
      await this._step(this._slides[slide][subSlide]);
    } else if (this._currentSlide - slide === 1) {
      // previous
      const cs = this._slides[this._currentSlide];
      for (let i = cs.length - 1; i >= 0; i--) {
        this._subSlide = i;
        await this._step(cs[i]);
      }
      const ns = this._slides[slide];
      await this._step(ns[ns.length - 1]);
    } else if (this._currentSlide - slide === -1) {
      // next
      const ns = this._slides[slide];
      for (let i = 0; i < ns.length; i++) {
        this._subSlide = i;
        await this._step(ns[i]);
      }
    } else {
      // jump
      const cs = this._slides[slide];
      this._subSlide = cs.length - 1;
      await this._step(cs[cs.length - 1]);
    }

    this._currentSlide = slide;
    this._seekPosition = 100;
    this._subSeekPosition = 100;
    this.releaseLock();
    this._update(this._state);
  }

  next() {
    return this.setSlide(this.currentSlide + 1);
  }

  previous() {
    return this.setSlide(this.currentSlide - 1);
  }

  toStart() {
    return this.setSlide(0);
  }

  toEnd() {
    return this.setSlide(this.length - 1);
  }

  async seek(percent) {
    if (this.acquireLock()) {
      this._update(this._state);
      this.log(
        `seek to ${percent}%, current: ${this._seekPosition}% [${this._currentSlide}/${this._subSlide}]`
      );
      const sspercent = 100 / this.slide.length;
      let ss = Math.floor(percent / sspercent); // new subslide
      let sp = (100 * (percent - ss * sspercent)) / sspercent; // new seek position
      this.log(`ss ${ss}, sp ${sp}`);
      if (ss >= this.slide.length) {
        ss = this.slide.length - 1;
        sp = 100;
      }
      if (ss !== this._subSlide) {
        // need to change subslide
        this._subSlide = ss;
        await this._jump(this._currentSlide, this._subSlide, sp);
      } else {
        this.vizzu.animation.seek(`${sp}%`);
      }
      this._seekPosition = percent;
      this._subSeekPosition = sp;
      this.releaseLock();
    }
    this._update(this._state);
  }

  get _state() {
    return {
      currentSlide: this.currentSlide,
      slide: this.slide,
      subSlide: this._subSlide,
      seekPosition: this._seekPosition,
      subSeekPosition: this._subSeekPosition,
      length: this.length,
      locked: this._locked,
    };
  }

  _update(state) {
    const e = new CustomEvent("update", { detail: state });
    this.dispatchEvent(e);
  }

  get customSpinner() {
    return this.getAttribute("custom-spinner");
  }

  _render() {
    return `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          --_c: var(--vizzu-color, #333);
          --_bg: var(--vizzu-background-color, #fff);
          background-color: var(--_bg);
        }
        :host([initializing]) #vizzu {
          visibility: hidden;
        }
        :host([initializing]) .spinner {
          display: block;
        }
        #vizzucnt {
          position: relative;
          display: flex;
          justify-content: center;
          align-items: center;
          width: 100%;
          max-height: calc(100% - 50px);
          box-sizing: border-box;
          flex: 1;
        }
        #vizzu {
          width: 100%;
          height: 100%;
          flex: 1;
        }
        .spinner {
          display: none;
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          margin: auto;
          width: 80px;
          height: 80px;
        }
        ${
          this.customSpinner
            ? `
        .spinner {
          background-image: url(${this.customSpinner});
          background-repeat: no-repeat;
          background-position: center;
          width: auto;
          height: auto;
        }`
            : `
        .spinner:after {
          content: " ";
          display: block;
          width: 64px;
          height: 64px;
          margin: 8px;
          border-radius: 50%;
          border: 6px solid #fff;
          border-color: var(--_c) transparent var(--_c) transparent;
          animation: spin 1.2s linear infinite;
        }`
        }
        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
      </style>
      <div id="vizzucnt">
        <canvas id="vizzu"></canvas>
        <div class="spinner"></div>
      </div>
      ${
        this._includeController
          ? `<vizzu-controller id="controller" slider-update="input"></vizzu-controller>`
          : ""
      }
      `;
  }
}

customElements.define("vizzu-player", VizzuPlayer);

export default VizzuPlayer;
export { VizzuController };
