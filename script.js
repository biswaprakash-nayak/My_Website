const menuBtn = document.querySelector('[data-menu-btn]');
const mobileMenu = document.querySelector('[data-mobile-menu]');
const aboutNextButton = document.querySelector('[data-about-next]');
const originalToggleButtons = document.querySelectorAll('[data-original-toggle]');

function syncReportViewerHeights() {
  const reportPanels = document.querySelectorAll('.pdf-showcase-panel');

  reportPanels.forEach(panel => {
    if (panel.classList.contains('showing-original')) {
      return;
    }

    const media = panel.querySelector('.pdf-media-large');
    const actions = panel.querySelector('.pdf-copy .pdf-actions');

    if (!media || !actions) {
      return;
    }

    const mediaTop = media.getBoundingClientRect().top;
    const actionsBottom = actions.getBoundingClientRect().bottom;
    const targetHeight = Math.max(280, Math.round(actionsBottom - mediaTop));

    media.style.height = `${targetHeight}px`;
    media.style.minHeight = `${targetHeight}px`;
  });
}

if (menuBtn && mobileMenu) {
  menuBtn.addEventListener('click', () => {
    mobileMenu.classList.toggle('open');
  });
}

if (aboutNextButton) {
  aboutNextButton.addEventListener('click', event => {
    event.preventDefault();
    const target = document.querySelector('#about-me-panel');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

if (originalToggleButtons.length > 0) {
  originalToggleButtons.forEach(button => {
    const card = button.closest('[data-original-card]');

    if (!card) {
      return;
    }

    const summaryBlock = card.querySelector('[data-summary]');
    const originalBlock = card.querySelector('[data-original]');

    if (!summaryBlock || !originalBlock) {
      return;
    }

    button.addEventListener('click', () => {
      const showingOriginal = !originalBlock.hasAttribute('hidden');

      if (showingOriginal) {
        originalBlock.setAttribute('hidden', '');
        summaryBlock.removeAttribute('hidden');
        card.classList.remove('showing-original');
        button.textContent = 'Show original wording';
        button.classList.remove('is-active');
      } else {
        summaryBlock.setAttribute('hidden', '');
        originalBlock.removeAttribute('hidden');
        card.classList.add('showing-original');
        button.textContent = 'Back to summary';
        button.classList.add('is-active');
      }

      syncReportViewerHeights();
    });
  });
}

const openCosmikProjectLink = document.querySelector('[data-open-cosmik-project]');
const cosmikIframe = document.querySelector('[data-cosmik-iframe]');

const getCosmikBaseUrl = () => {
  const host = window.location.hostname;
  const isLocalHost = host === '127.0.0.1' || host === 'localhost';

  if (isLocalHost && window.location.port === '9900') {
    return `${window.location.origin}/cosmik`;
  }

  return `${window.location.origin}/cosmik`;
};

const cosmikBaseUrl = getCosmikBaseUrl();

if (cosmikIframe instanceof HTMLIFrameElement) {
  cosmikIframe.src = `${cosmikBaseUrl}/visualizer?embed=1`;
}

if (openCosmikProjectLink instanceof HTMLAnchorElement) {
  openCosmikProjectLink.href = `${cosmikBaseUrl}/`;
}

if (openCosmikProjectLink) {
  openCosmikProjectLink.addEventListener('click', event => {
    event.preventDefault();
    const portfolioReturn = encodeURIComponent(window.location.href);
    window.location.href = `${cosmikBaseUrl}/?portfolioReturn=${portfolioReturn}`;
  });
}

const observer = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  },
  { threshold: 0.14 }
);

document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

const showcasePanels = document.querySelectorAll('[data-showcase-panel]');
const scrollNextButtons = document.querySelectorAll('[data-scroll-next]');

if (showcasePanels.length > 0) {
  const setActivePanel = panel => {
    showcasePanels.forEach(item => item.classList.remove('panel-active'));
    panel.classList.add('panel-active');

    const glazeValue = panel.getAttribute('data-glaze');
    if (glazeValue) {
      document.body.style.setProperty('--showcase-glaze', glazeValue);
    }
  };

  setActivePanel(showcasePanels[0]);

  const panelObserver = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          setActivePanel(entry.target);
        }
      });
    },
    { threshold: 0.55 }
  );

  showcasePanels.forEach(panel => panelObserver.observe(panel));
}

if (scrollNextButtons.length > 0 && showcasePanels.length > 0) {
  scrollNextButtons.forEach(button => {
    button.addEventListener('click', () => {
      const currentPanel = button.closest('[data-showcase-panel]');
      const panelList = Array.from(showcasePanels);
      const currentIndex = currentPanel ? panelList.indexOf(currentPanel) : -1;
      const nextPanel = currentIndex >= 0 && currentIndex < panelList.length - 1
        ? panelList[currentIndex + 1]
        : panelList[0];

      if (nextPanel) {
        nextPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

const presentationViewers = document.querySelectorAll('[data-presentation-viewer]');

if (presentationViewers.length > 0) {
  presentationViewers.forEach(deck => {
    const slideImage = deck.querySelector('[data-slide-image]');
    const slideStage = deck.querySelector('.slide-stage');
    const slideCountValue = Number(deck.getAttribute('data-slide-count') || '1');
    const prevBtn = deck.querySelector('[data-slide-prev]');
    const nextBtn = deck.querySelector('[data-slide-next]');
    const countLabel = deck.querySelector('[data-slide-count]');

    if (!slideImage || !slideStage || !prevBtn || !nextBtn || !countLabel) {
      return;
    }

    let currentPage = 1;
    const totalPages = Number.isFinite(slideCountValue) && slideCountValue > 0 ? slideCountValue : 21;
    let wheelLocked = false;

    const renderSlide = page => {
      const safePage = Math.min(Math.max(page, 1), totalPages);
      currentPage = safePage;
      slideImage.src = `transport-climate-slides/slide-${safePage}.png`;
      slideImage.alt = `Group Assignment 5 slide ${safePage}`;
      countLabel.textContent = `Slide ${safePage} / ${totalPages}`;
    };

    const stepSlide = delta => {
      renderSlide(currentPage + delta);
    };

    prevBtn.addEventListener('click', () => stepSlide(-1));
    nextBtn.addEventListener('click', () => stepSlide(1));

    deck.addEventListener(
      'wheel',
      event => {
        event.preventDefault();

        if (wheelLocked) {
          return;
        }

        wheelLocked = true;
        const direction = event.deltaY > 0 ? 1 : -1;
        stepSlide(direction);

        setTimeout(() => {
          wheelLocked = false;
        }, 260);
      },
      { passive: false }
    );
    renderSlide(1);
  });
}

const reportViewers = document.querySelectorAll('[data-report-viewer]');

if (reportViewers.length > 0 && window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  reportViewers.forEach(viewer => {
    const stage = viewer.querySelector('[data-report-stage]');
    const pagesContainer = viewer.querySelector('[data-report-pages]');
    const pdfUrl = viewer.getAttribute('data-report-pdf');

    if (!stage || !pagesContainer || !pdfUrl) {
      return;
    }

    let pdfDoc = null;
    let renderingAll = false;
    let rerenderQueued = false;
    let resizeTimeout = null;

    const renderAllPages = async () => {
      if (!pdfDoc || renderingAll) {
        rerenderQueued = true;
        return;
      }

      renderingAll = true;
      rerenderQueued = false;

      pagesContainer.innerHTML = '';

      for (let i = 1; i <= pdfDoc.numPages; i += 1) {
        const page = await pdfDoc.getPage(i);
        const baseViewport = page.getViewport({ scale: 1 });
        const stageWidth = stage.clientWidth || baseViewport.width;
        const scale = Math.max(stageWidth / baseViewport.width, 0.5);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.className = 'report-canvas';
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        pagesContainer.appendChild(canvas);

        const context = canvas.getContext('2d');

        if (context) {
          await page.render({
            canvasContext: context,
            viewport
          }).promise;
        }
      }

      renderingAll = false;

      if (rerenderQueued) {
        renderAllPages();
      }
    };

    window.addEventListener('resize', () => {
      if (!pdfDoc) {
        syncReportViewerHeights();
        return;
      }

      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        syncReportViewerHeights();
        renderAllPages();
      }, 150);
    });

    window.pdfjsLib.getDocument(pdfUrl).promise.then(doc => {
      pdfDoc = doc;
      syncReportViewerHeights();
      renderAllPages();
    }).catch(() => {});
  });
}

window.addEventListener('load', () => {
  syncReportViewerHeights();
});

const cosmikScenes = document.querySelectorAll('[data-cosmik-scene]');

if (cosmikScenes.length > 0) {
  cosmikScenes.forEach(scene => {
    const canvas = scene.querySelector('[data-cosmik-canvas]');
    const sceneMode = scene.getAttribute('data-cosmik-mode') || 'card';
    const isImmersive = sceneMode === 'immersive';

    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }

    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    const stars = Array.from({ length: isImmersive ? 320 : 180 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.8 + 0.3,
      a: Math.random() * 0.45 + 0.25,
      drift: (Math.random() - 0.5) * (isImmersive ? 0.0002 : 0.00012)
    }));

    const planets = [
      { orbit: 0.16, radius: 4, color: '#9d9386', speed: 0.0009, phase: Math.random() * Math.PI * 2 },
      { orbit: 0.24, radius: 6, color: '#d5a774', speed: 0.00072, phase: Math.random() * Math.PI * 2 },
      { orbit: 0.32, radius: 6.5, color: '#4f8ddf', speed: 0.00058, phase: Math.random() * Math.PI * 2 },
      { orbit: 0.41, radius: 5.2, color: '#b9653f', speed: 0.00048, phase: Math.random() * Math.PI * 2 },
      { orbit: 0.52, radius: 11, color: '#d0b28a', speed: 0.00031, phase: Math.random() * Math.PI * 2 },
      { orbit: 0.64, radius: 9.2, color: '#d5c39c', speed: 0.00024, phase: Math.random() * Math.PI * 2, ring: true },
      { orbit: 0.75, radius: 7.6, color: '#5b8fff', speed: 0.00019, phase: Math.random() * Math.PI * 2 },
      { orbit: 0.86, radius: 7.4, color: '#4a76d3', speed: 0.00015, phase: Math.random() * Math.PI * 2 }
    ];

    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let animationFrameId = 0;
    let lastTime = 0;

    const resize = () => {
      width = Math.max(scene.clientWidth, 1);
      height = Math.max(scene.clientHeight, 1);
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const draw = time => {
      const dt = lastTime === 0 ? 16 : Math.min(time - lastTime, 40);
      lastTime = time;

      const cx = width * (isImmersive ? 0.66 : 0.52);
      const cy = height * (isImmersive ? 0.53 : 0.52);
      const minDim = Math.min(width, height);

      context.clearRect(0, 0, width, height);

      const bg = context.createRadialGradient(cx, cy, minDim * 0.06, cx, cy, minDim * (isImmersive ? 0.95 : 0.75));
      bg.addColorStop(0, 'rgba(231, 147, 45, 0.22)');
      bg.addColorStop(0.45, 'rgba(27, 23, 32, 0.9)');
      bg.addColorStop(1, 'rgba(8, 12, 20, 1)');
      context.fillStyle = bg;
      context.fillRect(0, 0, width, height);

      stars.forEach(star => {
        star.y += star.drift * dt;
        if (star.y > 1.02) {
          star.y = -0.02;
        }
        if (star.y < -0.02) {
          star.y = 1.02;
        }

        context.beginPath();
        context.fillStyle = `rgba(255, 211, 130, ${star.a})`;
        context.arc(star.x * width, star.y * height, star.r, 0, Math.PI * 2);
        context.fill();
      });

      planets.forEach((planet, index) => {
        const ringRadius = minDim * planet.orbit;
        context.beginPath();
        context.strokeStyle = index % 2 === 0 ? 'rgba(160, 170, 190, 0.16)' : 'rgba(210, 180, 130, 0.14)';
        context.lineWidth = 1;
        context.ellipse(cx, cy, ringRadius, ringRadius * (isImmersive ? 0.72 : 0.78), 0, 0, Math.PI * 2);
        context.stroke();
      });

      const core = context.createRadialGradient(cx, cy, minDim * 0.005, cx, cy, minDim * 0.06);
      core.addColorStop(0, 'rgba(255, 245, 223, 0.98)');
      core.addColorStop(0.55, 'rgba(250, 187, 90, 0.92)');
      core.addColorStop(1, 'rgba(214, 114, 30, 0.16)');
      context.fillStyle = core;
      context.beginPath();
      context.arc(cx, cy, minDim * 0.055, 0, Math.PI * 2);
      context.fill();

      planets.forEach(planet => {
        planet.phase += planet.speed * dt;
        const ringRadius = minDim * planet.orbit;
        const px = cx + Math.cos(planet.phase) * ringRadius;
        const py = cy + Math.sin(planet.phase) * ringRadius * (isImmersive ? 0.72 : 0.78);

        if (planet.ring) {
          context.save();
          context.translate(px, py);
          context.rotate(-0.34);
          context.beginPath();
          context.strokeStyle = 'rgba(211, 190, 140, 0.62)';
          context.lineWidth = 1.7;
          context.ellipse(0, 0, planet.radius * 1.95, planet.radius * 0.75, 0, 0, Math.PI * 2);
          context.stroke();
          context.restore();
        }

        const glow = context.createRadialGradient(px, py, planet.radius * 0.15, px, py, planet.radius * 2.2);
        glow.addColorStop(0, 'rgba(255, 255, 255, 0.88)');
        glow.addColorStop(0.45, `${planet.color}cc`);
        glow.addColorStop(1, `${planet.color}10`);
        context.fillStyle = glow;
        context.beginPath();
        context.arc(px, py, planet.radius * 2.2, 0, Math.PI * 2);
        context.fill();

        context.fillStyle = planet.color;
        context.beginPath();
        context.arc(px, py, planet.radius, 0, Math.PI * 2);
        context.fill();
      });

      animationFrameId = window.requestAnimationFrame(draw);
    };

    resize();
    animationFrameId = window.requestAnimationFrame(draw);

    window.addEventListener('resize', resize);

    scene.addEventListener('remove', () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
    });
  });
}

const buildPhotoUrl = filename => `photo%20galary/${encodeURIComponent(filename)}`;

const loadPhotoManifest = async () => {
  try {
    const response = await fetch('photo-gallery-manifest.json', { cache: 'no-store' });
    if (!response.ok) {
      return [];
    }
    const parsed = await response.json();
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(name => typeof name === 'string' && name.trim().length > 0);
  } catch {
    return [];
  }
};

const initHobbiesExperience = async () => {
  const rollingTracks = document.querySelectorAll('[data-rolling-track]');

  if (rollingTracks.length === 0) {
    return;
  }

  const filenames = await loadPhotoManifest();

  if (filenames.length === 0) {
    return;
  }

  const renderRollingTrack = (trackElement, files) => {
    if (!(trackElement instanceof HTMLElement) || files.length === 0) {
      return;
    }

    trackElement.innerHTML = '';
    const doubled = [...files, ...files];

    doubled.forEach((filename, index) => {
      const image = document.createElement('img');
      image.src = buildPhotoUrl(filename);
      image.alt = `Photography preview ${index + 1}`;
      image.loading = 'lazy';
      trackElement.appendChild(image);
    });
  };

  const firstStrip = filenames.slice(0, 24);
  const secondStrip = filenames.slice(24, 48);

  renderRollingTrack(rollingTracks[0], firstStrip.length > 0 ? firstStrip : filenames.slice(0, 16));
  renderRollingTrack(rollingTracks[1], secondStrip.length > 0 ? secondStrip : filenames.slice(8, 24));
};

const initPhotoGalleryPage = async () => {
  const galleryGrid = document.querySelector('[data-gallery-page-grid]');

  if (!(galleryGrid instanceof HTMLElement)) {
    return;
  }

  const filenames = await loadPhotoManifest();

  if (filenames.length === 0) {
    galleryGrid.innerHTML = '<p class="gallery-empty">No photos found.</p>';
    return;
  }

  const photoUrls = filenames.map(buildPhotoUrl);
  let activePhotoIndex = 0;
  let wheelLocked = false;
  let overlayScale = 1;
  const minOverlayScale = 1;
  const maxOverlayScale = 3;
  const overlayScaleStep = 0.2;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartScrollLeft = 0;
  let panStartScrollTop = 0;

  const overlay = document.createElement('div');
  overlay.className = 'gallery-overlay';
  overlay.setAttribute('hidden', '');

  const overlayShell = document.createElement('div');
  overlayShell.className = 'gallery-overlay-shell';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'gallery-overlay-close';
  closeButton.textContent = 'Close';
  closeButton.setAttribute('aria-label', 'Close gallery viewer');

  const prevButton = document.createElement('button');
  prevButton.type = 'button';
  prevButton.className = 'gallery-overlay-nav gallery-overlay-nav-up';
  prevButton.textContent = '↑';
  prevButton.setAttribute('aria-label', 'Previous image');

  const overlayViewport = document.createElement('div');
  overlayViewport.className = 'gallery-overlay-viewport';

  const overlayImage = document.createElement('img');
  overlayImage.className = 'gallery-overlay-image';
  overlayImage.alt = 'Expanded gallery image';

  overlayViewport.appendChild(overlayImage);

  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'gallery-overlay-nav gallery-overlay-nav-down';
  nextButton.textContent = '↓';
  nextButton.setAttribute('aria-label', 'Next image');

  const overlayCounter = document.createElement('p');
  overlayCounter.className = 'gallery-overlay-counter';

  const zoomControls = document.createElement('div');
  zoomControls.className = 'gallery-overlay-zoom-controls';

  const zoomOutButton = document.createElement('button');
  zoomOutButton.type = 'button';
  zoomOutButton.className = 'gallery-overlay-zoom-btn';
  zoomOutButton.textContent = '-';
  zoomOutButton.setAttribute('aria-label', 'Zoom out');

  const zoomResetButton = document.createElement('button');
  zoomResetButton.type = 'button';
  zoomResetButton.className = 'gallery-overlay-zoom-btn';
  zoomResetButton.textContent = '100%';
  zoomResetButton.setAttribute('aria-label', 'Reset zoom');

  const zoomInButton = document.createElement('button');
  zoomInButton.type = 'button';
  zoomInButton.className = 'gallery-overlay-zoom-btn';
  zoomInButton.textContent = '+';
  zoomInButton.setAttribute('aria-label', 'Zoom in');

  zoomControls.appendChild(zoomOutButton);
  zoomControls.appendChild(zoomResetButton);
  zoomControls.appendChild(zoomInButton);

  overlayShell.appendChild(closeButton);
  overlayShell.appendChild(prevButton);
  overlayShell.appendChild(overlayViewport);
  overlayShell.appendChild(nextButton);
  overlayShell.appendChild(zoomControls);
  overlayShell.appendChild(overlayCounter);
  overlay.appendChild(overlayShell);
  document.body.appendChild(overlay);

  const updateOverlayScale = () => {
    overlayScale = Math.min(maxOverlayScale, Math.max(minOverlayScale, overlayScale));
    overlayImage.style.transform = `scale(${overlayScale})`;
    zoomResetButton.textContent = `${Math.round(overlayScale * 100)}%`;
    overlayViewport.style.overflow = overlayScale > 1 ? 'auto' : 'hidden';
    overlayViewport.classList.toggle('is-zoomed', overlayScale > 1);
    overlayImage.style.cursor = overlayScale > 1 ? 'zoom-out' : 'zoom-in';
  };

  const stopPanning = () => {
    if (!isPanning) {
      return;
    }

    isPanning = false;
    overlayViewport.classList.remove('is-panning');
  };

  const startPanning = event => {
    if (overlayScale <= 1 || event.button !== 0) {
      return;
    }

    isPanning = true;
    panStartX = event.clientX;
    panStartY = event.clientY;
    panStartScrollLeft = overlayViewport.scrollLeft;
    panStartScrollTop = overlayViewport.scrollTop;
    overlayViewport.classList.add('is-panning');
    event.preventDefault();
  };

  const movePanning = event => {
    if (!isPanning) {
      return;
    }

    const dx = event.clientX - panStartX;
    const dy = event.clientY - panStartY;
    overlayViewport.scrollLeft = panStartScrollLeft - dx;
    overlayViewport.scrollTop = panStartScrollTop - dy;
  };

  const setOverlayScale = nextScale => {
    overlayScale = nextScale;
    updateOverlayScale();
  };

  const resetOverlayScale = () => {
    setOverlayScale(1);
  };

  const zoomOverlayBy = delta => {
    setOverlayScale(overlayScale + delta);
  };

  const updateOverlayImage = () => {
    const total = photoUrls.length;
    if (total === 0) {
      return;
    }

    activePhotoIndex = ((activePhotoIndex % total) + total) % total;
    const currentUrl = photoUrls[activePhotoIndex];
    overlayImage.src = currentUrl;
    overlayImage.alt = `Expanded gallery image ${activePhotoIndex + 1}`;
    overlayCounter.textContent = `${activePhotoIndex + 1} / ${total}`;
    resetOverlayScale();
  };

  const closeOverlay = () => {
    stopPanning();
    overlay.setAttribute('hidden', '');
    document.body.classList.remove('gallery-overlay-open');
  };

  const openOverlayAt = index => {
    activePhotoIndex = index;
    updateOverlayImage();
    overlay.removeAttribute('hidden');
    document.body.classList.add('gallery-overlay-open');
  };

  const stepOverlay = delta => {
    activePhotoIndex += delta;
    updateOverlayImage();
  };

  closeButton.addEventListener('click', closeOverlay);
  prevButton.addEventListener('click', () => stepOverlay(-1));
  nextButton.addEventListener('click', () => stepOverlay(1));
  zoomOutButton.addEventListener('click', () => zoomOverlayBy(-overlayScaleStep));
  zoomInButton.addEventListener('click', () => zoomOverlayBy(overlayScaleStep));
  zoomResetButton.addEventListener('click', resetOverlayScale);

  overlayImage.addEventListener('dblclick', () => {
    if (overlayScale > 1) {
      resetOverlayScale();
    } else {
      setOverlayScale(2);
    }
  });

  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      closeOverlay();
    }
  });

  overlayViewport.addEventListener('mousedown', startPanning);
  window.addEventListener('mousemove', movePanning);
  window.addEventListener('mouseup', stopPanning);

  overlay.addEventListener(
    'wheel',
    event => {
      event.preventDefault();

      if (event.ctrlKey) {
        zoomOverlayBy(event.deltaY > 0 ? -overlayScaleStep : overlayScaleStep);
        return;
      }

      if (wheelLocked) {
        return;
      }

      wheelLocked = true;
      stepOverlay(event.deltaY > 0 ? 1 : -1);

      window.setTimeout(() => {
        wheelLocked = false;
      }, 180);
    },
    { passive: false }
  );

  document.addEventListener('keydown', event => {
    if (overlay.hasAttribute('hidden')) {
      return;
    }

    if (event.key === 'Escape') {
      closeOverlay();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      stepOverlay(1);
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      stepOverlay(-1);
    }

    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomOverlayBy(overlayScaleStep);
    }

    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomOverlayBy(-overlayScaleStep);
    }

    if (event.key === '0') {
      event.preventDefault();
      resetOverlayScale();
    }
  });

  galleryGrid.innerHTML = '';
  filenames.forEach((filename, index) => {
    const figure = document.createElement('figure');
    const image = document.createElement('img');
    const fullImageUrl = buildPhotoUrl(filename);
    image.src = fullImageUrl;
    image.alt = `Gallery photo ${index + 1}`;
    image.loading = 'lazy';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'gallery-tile-button';
    trigger.setAttribute('aria-label', `Open image ${index + 1} in viewer`);
    trigger.appendChild(image);

    trigger.addEventListener('click', () => {
      openOverlayAt(index);
    });

    figure.appendChild(trigger);
    galleryGrid.appendChild(figure);
  });
};

initHobbiesExperience();
initPhotoGalleryPage();

