import * as pdfjsLib from "./vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

const PDF_URL = "./book.pdf";
const CACHE_LIMIT = 14;
const THUMB_WIDTH = 170;
const MIN_ZOOM = 0.74;
const MAX_ZOOM = 1.85;
const ZOOM_STEP = 0.12;

const els = {
  app: document.getElementById("appShell"),
  bookArea: document.getElementById("bookArea"),
  bookHost: document.getElementById("bookHost"),
  bookPlatform: document.getElementById("bookPlatform"),
  loading: document.getElementById("loadingScreen"),
  loadingTitle: document.getElementById("loadingTitle"),
  loadingDetail: document.getElementById("loadingDetail"),
  loadBar: document.getElementById("loadBar"),
  pageIndicator: document.getElementById("pageIndicator"),
  pageRange: document.getElementById("pageRange"),
  status: document.getElementById("statusText"),
  thumbList: document.getElementById("thumbList"),
  thumbPanel: document.getElementById("thumbPanel"),
  zoomIndicator: document.getElementById("zoomIndicator"),
};

const state = {
  pdf: null,
  pageCount: 0,
  pageRatio: Math.SQRT2,
  currentPage: 0,
  previousPage: 0,
  pageFlip: null,
  pageCache: new Map(),
  renderTasks: new Map(),
  thumbTasks: new Map(),
  layout: {
    pageWidth: 480,
    pageHeight: 679,
    bookWidth: 960,
    isSingle: false,
  },
  zoom: 1,
  viewMode: "auto",
  resizeTimer: 0,
  audio: null,
  audioUnlocked: false,
  thumbObserver: null,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pageIsCover(index) {
  return index === 0 || index === state.pageCount - 1;
}

function validPage(index) {
  return index >= 0 && index < state.pageCount;
}

function setProgress(percent) {
  els.loadBar.style.width = `${clamp(percent, 0, 100)}%`;
}

function setStatus(text) {
  els.status.textContent = text;
  els.loadingDetail.textContent = text;
}

function computeLayout() {
  const area = els.bookArea.getBoundingClientRect();
  const narrow = window.matchMedia("(max-width: 760px)").matches;
  const isSingle = state.viewMode === "single" || narrow;
  const horizontalPadding = narrow ? 28 : 72;
  const verticalPadding = narrow ? 28 : 72;
  const availableWidth = Math.max(280, area.width - horizontalPadding);
  const availableHeight = Math.max(360, area.height - verticalPadding);
  const pagesAcross = isSingle ? 1 : 2;
  const byWidth = availableWidth / pagesAcross;
  const byHeight = availableHeight / state.pageRatio;
  const maxPageWidth = narrow ? 520 : 760;
  const pageWidth = Math.floor(clamp(Math.min(byWidth, byHeight), 230, maxPageWidth));
  const pageHeight = Math.floor(pageWidth * state.pageRatio);
  const bookWidth = isSingle ? pageWidth : pageWidth * 2;

  state.layout = {
    pageWidth,
    pageHeight,
    bookWidth,
    isSingle,
  };

  document.documentElement.style.setProperty("--page-w", `${pageWidth}px`);
  document.documentElement.style.setProperty("--page-h", `${pageHeight}px`);
  document.documentElement.style.setProperty("--book-w", `${bookWidth}px`);
  document.documentElement.style.setProperty("--zoom", state.zoom.toFixed(2));
  els.bookHost.style.width = `${bookWidth}px`;
  els.bookHost.style.height = `${pageHeight}px`;
}

function createPageElement(index) {
  const page = document.createElement("div");
  page.className = "page";
  page.dataset.pageIndex = String(index);
  if (pageIsCover(index)) {
    page.dataset.density = "hard";
    page.classList.add(index === 0 ? "front-cover" : "back-cover");
  } else {
    page.dataset.density = "soft";
  }

  const inner = document.createElement("div");
  inner.className = "page-inner";

  const img = document.createElement("img");
  img.className = "page-image";
  img.alt = pageIsCover(index)
    ? index === 0
      ? "Front cover"
      : "Back cover"
    : `Page ${index + 1}`;
  img.draggable = false;

  const loader = document.createElement("div");
  loader.className = "page-loader";
  loader.textContent = "Rendering";

  inner.append(img, loader);
  page.append(inner);

  if (pageIsCover(index)) {
    const edge = document.createElement("div");
    edge.className = "cover-edge";
    page.append(edge);
  }

  return page;
}

function buildFlipbook(startPage = state.currentPage) {
  computeLayout();

  if (state.pageFlip) {
    try {
      state.pageFlip.destroy();
    } catch {
      els.bookHost.innerHTML = "";
    }
    state.pageFlip = null;
  }

  els.bookHost.innerHTML = "";
  const flipbook = document.createElement("div");
  flipbook.className = "flipbook";
  flipbook.style.width = `${state.layout.bookWidth}px`;
  flipbook.style.height = `${state.layout.pageHeight}px`;

  for (let index = 0; index < state.pageCount; index += 1) {
    flipbook.append(createPageElement(index));
  }

  els.bookHost.append(flipbook);

  state.pageFlip = new window.St.PageFlip(flipbook, {
    width: state.layout.pageWidth,
    height: state.layout.pageHeight,
    size: "fixed",
    startPage: clamp(startPage, 0, state.pageCount - 1),
    drawShadow: true,
    flippingTime: 920,
    usePortrait: true,
    startZIndex: 2,
    autoSize: false,
    maxShadowOpacity: 0.54,
    showCover: true,
    mobileScrollSupport: false,
    swipeDistance: 22,
    clickEventForward: true,
    useMouseEvents: true,
    showPageCorners: true,
    disableFlipByClick: false,
  });

  state.pageFlip.on("init", (event) => {
    state.currentPage = event.data.page || 0;
    updateChrome();
    paintCachedPages();
    queueVisibleRender();
  });

  state.pageFlip.on("flip", (event) => {
    const nextPage = event.data;
    state.previousPage = state.currentPage;
    state.currentPage = nextPage;
    updateChrome();
    queueVisibleRender();
    playFlipSound(pageIsCover(nextPage) || pageIsCover(state.previousPage));
  });

  state.pageFlip.on("changeOrientation", () => {
    updateChrome();
    queueVisibleRender();
  });

  state.pageFlip.loadFromHTML(flipbook.querySelectorAll(".page"));
  paintCachedPages();
}

function pageLabel(index) {
  if (index === 0) return `Front cover ${index + 1} / ${state.pageCount}`;
  if (index === state.pageCount - 1) return `Back cover ${state.pageCount} / ${state.pageCount}`;

  const orientation = state.pageFlip?.getOrientation?.();
  if (orientation === "landscape" && !state.layout.isSingle) {
    const spreadEnd = Math.min(index + 2, state.pageCount - 1);
    return `Pages ${index + 1}-${spreadEnd} / ${state.pageCount}`;
  }

  return `Page ${index + 1} / ${state.pageCount}`;
}

function updateChrome() {
  els.pageIndicator.textContent = pageLabel(state.currentPage);
  els.pageRange.value = String(state.currentPage + 1);
  els.zoomIndicator.textContent = `${Math.round(state.zoom * 100)}%`;
  els.bookPlatform.classList.toggle("is-cover", pageIsCover(state.currentPage));

  document.querySelectorAll(".thumb-button.is-active").forEach((button) => {
    button.classList.remove("is-active");
  });
  const active = els.thumbList.querySelector(`[data-page-index="${state.currentPage}"]`);
  active?.classList.add("is-active");

  const spreadButton = document.querySelector('[data-action="spread"]');
  spreadButton?.classList.toggle("is-active", state.viewMode === "single");

  const prev = document.querySelector('[data-action="prev"]');
  const next = document.querySelector('[data-action="next"]');
  if (prev) prev.disabled = state.currentPage <= 0;
  if (next) next.disabled = state.currentPage >= state.pageCount - 1;
}

function targetRenderWidth() {
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2.25);
  return Math.round(clamp(state.layout.pageWidth * state.zoom * dpr * 1.35, 900, 2400));
}

function renderWindow(center) {
  const indexes = new Set([0, state.pageCount - 1]);
  const orientation = state.pageFlip?.getOrientation?.();
  const range = orientation === "landscape" && !state.layout.isSingle ? 3 : 2;
  for (let offset = -range; offset <= range; offset += 1) {
    indexes.add(center + offset);
  }
  indexes.add(center + 1);
  return [...indexes].filter(validPage);
}

function queueVisibleRender() {
  const pages = renderWindow(state.currentPage);
  pages.forEach((index) => {
    renderPage(index);
  });
  evictPageCache(pages);
}

function paintCachedPages() {
  for (const index of state.pageCache.keys()) {
    paintPage(index);
  }
}

function paintPage(index) {
  const cached = state.pageCache.get(index);
  if (!cached) return;

  document
    .querySelectorAll(`.page[data-page-index="${index}"]`)
    .forEach((page) => {
      const img = page.querySelector(".page-image");
      if (img && img.src !== cached.url) img.src = cached.url;
      page.classList.add("is-rendered");
    });
}

async function renderPage(index) {
  if (!validPage(index) || !state.pdf) return;

  const requestedWidth = targetRenderWidth();
  const cached = state.pageCache.get(index);
  if (cached && cached.width >= requestedWidth * 0.88) {
    cached.touched = performance.now();
    paintPage(index);
    return;
  }

  const taskKey = `${index}:${requestedWidth}`;
  if (state.renderTasks.has(taskKey)) {
    await state.renderTasks.get(taskKey);
    return;
  }

  const task = (async () => {
    const pdfPage = await state.pdf.getPage(index + 1);
    const base = pdfPage.getViewport({ scale: 1 });
    const scale = requestedWidth / base.width;
    const viewport = pdfPage.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await pdfPage.render({
      canvasContext: ctx,
      viewport,
      intent: "display",
    }).promise;

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", pageIsCover(index) ? 0.96 : 0.93);
    });

    if (!blob) throw new Error(`Could not render page ${index + 1}`);

    const old = state.pageCache.get(index);
    if (old) URL.revokeObjectURL(old.url);

    state.pageCache.set(index, {
      url: URL.createObjectURL(blob),
      width: canvas.width,
      height: canvas.height,
      touched: performance.now(),
    });

    paintPage(index);
  })()
    .catch((error) => {
      console.error(error);
      setStatus(`Page ${index + 1} render failed`);
    })
    .finally(() => {
      state.renderTasks.delete(taskKey);
    });

  state.renderTasks.set(taskKey, task);
  await task;
}

function evictPageCache(keepPages = []) {
  const keep = new Set(keepPages);
  if (state.pageCache.size <= CACHE_LIMIT) return;

  const entries = [...state.pageCache.entries()]
    .filter(([index]) => !keep.has(index))
    .sort((a, b) => a[1].touched - b[1].touched);

  while (state.pageCache.size > CACHE_LIMIT && entries.length) {
    const [index, cached] = entries.shift();
    URL.revokeObjectURL(cached.url);
    state.pageCache.delete(index);
    document
      .querySelectorAll(`.page[data-page-index="${index}"]`)
      .forEach((page) => {
        page.classList.remove("is-rendered");
        const img = page.querySelector(".page-image");
        if (img) img.removeAttribute("src");
      });
  }
}

function createThumbnails() {
  els.thumbList.innerHTML = "";
  state.thumbObserver?.disconnect();

  state.thumbObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const index = Number(entry.target.dataset.pageIndex);
          renderThumbnail(index);
        }
      });
    },
    {
      root: els.thumbList,
      rootMargin: "160px 0px",
    }
  );

  for (let index = 0; index < state.pageCount; index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumb-button";
    button.dataset.pageIndex = String(index);
    button.setAttribute("aria-label", `Open page ${index + 1}`);

    const wrap = document.createElement("span");
    wrap.className = "thumb-canvas-wrap";

    const canvas = document.createElement("canvas");
    canvas.width = THUMB_WIDTH;
    canvas.height = Math.round(THUMB_WIDTH * state.pageRatio);
    wrap.append(canvas);

    const label = document.createElement("span");
    label.textContent =
      index === 0 ? "Cover" : index === state.pageCount - 1 ? "Back" : `Page ${index + 1}`;

    button.append(wrap, label);
    els.thumbList.append(button);
    state.thumbObserver.observe(button);
  }
}

async function renderThumbnail(index) {
  if (!validPage(index) || state.thumbTasks.has(index)) return;

  const canvas = els.thumbList.querySelector(
    `.thumb-button[data-page-index="${index}"] canvas`
  );
  if (!canvas || canvas.dataset.rendered === "true") return;

  const task = (async () => {
    const pdfPage = await state.pdf.getPage(index + 1);
    const base = pdfPage.getViewport({ scale: 1 });
    const scale = THUMB_WIDTH / base.width;
    const viewport = pdfPage.getViewport({ scale });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({
      canvasContext: ctx,
      viewport,
      intent: "display",
    }).promise;
    canvas.dataset.rendered = "true";
  })()
    .catch((error) => console.error(error))
    .finally(() => state.thumbTasks.delete(index));

  state.thumbTasks.set(index, task);
  await task;
}

function unlockAudio() {
  if (state.audioUnlocked) return;

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(ctx.destination);

  state.audio = { ctx, master };
  state.audioUnlocked = true;
  ctx.resume();
}

function playFlipSound(isCover) {
  if (!state.audioUnlocked || !state.audio) return;

  const { ctx, master } = state.audio;
  ctx.resume();

  const duration = isCover ? 0.52 : 0.34;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    const t = i / data.length;
    const envelope = Math.sin(Math.PI * t) * (1 - t * 0.34);
    data[i] = (Math.random() * 2 - 1) * envelope;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(isCover ? 360 : 720, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(isCover ? 1100 : 1900, ctx.currentTime + duration);
  filter.Q.value = isCover ? 0.55 : 0.72;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(isCover ? 0.08 : 0.045, ctx.currentTime + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  noise.start();
  noise.stop(ctx.currentTime + duration);

  if (isCover) {
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(92, ctx.currentTime);
    thump.frequency.exponentialRampToValueAtTime(44, ctx.currentTime + 0.22);
    thumpGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    thumpGain.gain.exponentialRampToValueAtTime(0.065, ctx.currentTime + 0.018);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
    thump.connect(thumpGain);
    thumpGain.connect(master);
    thump.start();
    thump.stop(ctx.currentTime + 0.34);
  }
}

function goNext() {
  if (!state.pageFlip || state.currentPage >= state.pageCount - 1) return;
  state.pageFlip.flipNext("bottom");
}

function goPrev() {
  if (!state.pageFlip || state.currentPage <= 0) return;
  state.pageFlip.flipPrev("bottom");
}

function goToPage(pageNumber) {
  const index = clamp(pageNumber - 1, 0, state.pageCount - 1);
  if (!state.pageFlip) return;
  state.previousPage = state.currentPage;
  state.currentPage = index;
  state.pageFlip.turnToPage(index);
  updateChrome();
  queueVisibleRender();
}

function setZoom(nextZoom) {
  state.zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  document.documentElement.style.setProperty("--zoom", state.zoom.toFixed(2));
  updateChrome();
  queueVisibleRender();
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    els.app.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

function toggleThumbnails() {
  els.app.classList.toggle("thumbs-open");
}

function toggleSpreadMode() {
  state.viewMode = state.viewMode === "single" ? "auto" : "single";
  buildFlipbook(state.currentPage);
  queueVisibleRender();
  updateChrome();
}

function bindControls() {
  document.addEventListener("pointerdown", unlockAudio, { once: true });
  document.addEventListener("keydown", unlockAudio, { once: true });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    unlockAudio();

    const action = button.dataset.action;
    if (action === "thumbs") toggleThumbnails();
    if (action === "prev") goPrev();
    if (action === "next") goNext();
    if (action === "zoom-out") setZoom(state.zoom - ZOOM_STEP);
    if (action === "zoom-in") setZoom(state.zoom + ZOOM_STEP);
    if (action === "spread") toggleSpreadMode();
    if (action === "fullscreen") toggleFullscreen();
  });

  els.thumbList.addEventListener("click", (event) => {
    const button = event.target.closest(".thumb-button");
    if (!button) return;
    unlockAudio();
    goToPage(Number(button.dataset.pageIndex) + 1);
    if (window.matchMedia("(max-width: 900px)").matches) {
      els.app.classList.remove("thumbs-open");
    }
  });

  els.pageRange.addEventListener("input", (event) => {
    unlockAudio();
    goToPage(Number(event.target.value));
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
      event.preventDefault();
      goNext();
    }
    if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      goPrev();
    }
    if (event.key === "Home") {
      event.preventDefault();
      goToPage(1);
    }
    if (event.key === "End") {
      event.preventDefault();
      goToPage(state.pageCount);
    }
    if (event.key === "+" || event.key === "=") setZoom(state.zoom + ZOOM_STEP);
    if (event.key === "-") setZoom(state.zoom - ZOOM_STEP);
    if (event.key.toLowerCase() === "f") toggleFullscreen();
    if (event.key === "Escape") els.app.classList.remove("thumbs-open");
  });

  window.addEventListener("resize", () => {
    window.clearTimeout(state.resizeTimer);
    state.resizeTimer = window.setTimeout(() => {
      if (!state.pdf) return;
      buildFlipbook(state.currentPage);
      queueVisibleRender();
    }, 180);
  });
}

async function loadPdf() {
  const task = pdfjsLib.getDocument({
    url: PDF_URL,
    disableAutoFetch: true,
    disableStream: false,
    rangeChunkSize: 262144,
    useSystemFonts: true,
  });

  task.onProgress = ({ loaded, total }) => {
    if (total > 0) {
      const percent = (loaded / total) * 100;
      setProgress(percent);
      setStatus(`Loading book.pdf ${Math.round(percent)}%`);
    }
  };

  state.pdf = await task.promise;
  state.pageCount = state.pdf.numPages;
  els.pageRange.max = String(state.pageCount);

  const firstPage = await state.pdf.getPage(1);
  const viewport = firstPage.getViewport({ scale: 1 });
  state.pageRatio = viewport.height / viewport.width;
  setProgress(100);
  setStatus(`${state.pageCount} pages ready`);
}

function showError(error) {
  console.error(error);
  els.app.classList.add("is-error");
  els.loadingTitle.textContent = "Could not load book.pdf";
  const localHint =
    window.location.protocol === "file:"
      ? "Open this folder through a small static server so the browser can fetch the PDF."
      : "Check that book.pdf is in this same folder and the server can read it.";
  els.loadingDetail.textContent = localHint;
  els.status.textContent = "PDF load failed";
}

async function init() {
  bindControls();

  try {
    await loadPdf();
    createThumbnails();
    buildFlipbook(0);
    await renderPage(0);
    renderPage(1);
    renderThumbnail(0);
    updateChrome();
    els.loading.classList.add("is-hidden");
  } catch (error) {
    showError(error);
  }
}

init();
