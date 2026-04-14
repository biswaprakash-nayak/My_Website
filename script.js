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
