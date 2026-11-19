/* SolScape Retreats — Shared JS */

(function () {
  /* ── Mobile menu ──
     The button names the sheet with aria-controls in the markup; its state
     (aria-expanded) is only claimed here, where the button actually works. */
  const hamburger = document.querySelector('.hamburger');
  const mobileMenu = document.querySelector('.mobile-menu');

  if (hamburger && mobileMenu) {
    const setMenu = (open) => {
      hamburger.classList.toggle('open', open);
      mobileMenu.classList.toggle('open', open);
      hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.style.overflow = open ? 'hidden' : '';
    };
    hamburger.setAttribute('aria-expanded', 'false');

    hamburger.addEventListener('click', () => {
      setMenu(!mobileMenu.classList.contains('open'));
    });

    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => setMenu(false));
    });

    // Esc closes the sheet and puts focus back on the button that opened it.
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && mobileMenu.classList.contains('open')) {
        setMenu(false);
        hamburger.focus();
      }
    });
  }

  /* ── Retreats dropdown ──
     It opens on :hover / :focus-within (CSS). Esc dismisses it until the
     pointer and focus have both left the item, so it doesn't pop straight back. */
  document.querySelectorAll('.nav-item.has-dropdown').forEach(item => {
    const trigger = item.querySelector(':scope > a');
    let pointerIn = false;
    const reset = () => {
      if (!pointerIn && !item.contains(document.activeElement)) item.classList.remove('dismissed');
    };
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || item.classList.contains('dismissed')) return;
      if (!item.matches(':hover') && !item.matches(':focus-within')) return;
      item.classList.add('dismissed');
      // Focus on a link inside the now-hidden panel moves back to "Retreats".
      if (trigger && item.querySelector('.dropdown').contains(document.activeElement)) trigger.focus();
    });
    item.addEventListener('pointerenter', () => { pointerIn = true; });
    item.addEventListener('pointerleave', () => { pointerIn = false; reset(); });
    item.addEventListener('focusout', () => setTimeout(reset, 0));
  });

  /* ── Testimonial carousel ── */
  const track = document.querySelector('.testimonial-track');
  const dots = document.querySelectorAll('.carousel-dot');
  let current = 0;

  function goTo(index) {
    current = index;
    if (track) track.style.transform = `translateX(-${index * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle('active', i === index));
  }

  dots.forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));

  if (track && track.children.length > 1) {
    setInterval(() => goTo((current + 1) % track.children.length), 5500);
  }

  /* ── Lightbox gallery (room + property galleries) ──
     Triggers carry their image set in a base-aware `data-gallery` JSON
     attribute rendered by Astro; this script only reads it, never builds
     image paths itself (so the GitHub Pages sub-path stays intact). */
  const galleryTriggers = document.querySelectorAll('.js-gallery-open');
  if (galleryTriggers.length) {
    let lb, lbImg, lbCaption, current = [], index = 0, name = '', lastTrigger = null;

    function buildLightbox() {
      lb = document.createElement('div');
      lb.className = 'lightbox';
      lb.setAttribute('role', 'dialog');
      lb.setAttribute('aria-modal', 'true');
      lb.setAttribute('aria-label', 'Photo gallery');
      lb.setAttribute('aria-hidden', 'true');
      lb.innerHTML =
        '<button type="button" class="lightbox-btn lightbox-close" aria-label="Close gallery">&times;</button>' +
        '<button type="button" class="lightbox-btn lightbox-prev" aria-label="Previous photo">&#8249;</button>' +
        '<figure class="lightbox-figure">' +
          '<img class="lightbox-img" alt="">' +
          '<figcaption class="lightbox-caption"></figcaption>' +
        '</figure>' +
        '<button type="button" class="lightbox-btn lightbox-next" aria-label="Next photo">&#8250;</button>';
      document.body.appendChild(lb);

      lbImg = lb.querySelector('.lightbox-img');
      lbCaption = lb.querySelector('.lightbox-caption');

      lb.querySelector('.lightbox-close').addEventListener('click', close);
      lb.querySelector('.lightbox-prev').addEventListener('click', () => step(-1));
      lb.querySelector('.lightbox-next').addEventListener('click', () => step(1));
      // Click on the backdrop (not the figure/buttons) closes.
      lb.addEventListener('click', e => { if (e.target === lb) close(); });
    }

    function render() {
      const item = current[index];
      lbImg.src = item.src;
      lbImg.alt = item.alt || '';
      const counter = current.length > 1 ? ' · ' + (index + 1) + ' / ' + current.length : '';
      lbCaption.textContent = name + counter;
    }

    function step(dir) {
      if (!current.length) return;
      index = (index + dir + current.length) % current.length;
      render();
    }

    function open(images, galleryName, start, trigger) {
      if (!lb) buildLightbox();
      current = images;
      name = galleryName || '';
      index = start || 0;
      lastTrigger = trigger || null;
      render();
      lb.classList.add('open');
      lb.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', onKey);
      lb.querySelector('.lightbox-close').focus();
    }

    function close() {
      if (!lb) return;
      lb.classList.remove('open');
      lb.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      if (lastTrigger) lastTrigger.focus();
    }

    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    }

    galleryTriggers.forEach(btn => {
      btn.addEventListener('click', () => {
        const host = btn.matches('[data-gallery]') ? btn : btn.closest('[data-gallery]');
        if (!host) return;
        let data;
        try { data = JSON.parse(host.dataset.gallery); } catch (_) { return; }
        if (!data || !Array.isArray(data.images) || !data.images.length) return;
        const start = parseInt(btn.dataset.start || '0', 10) || 0;
        open(data.images, data.name, start, btn);
      });
    });
  }

})();
