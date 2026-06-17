/* SolScape Retreats — Shared JS */

(function () {
  /* ── Mobile menu ── */
  const hamburger = document.querySelector('.hamburger');
  const mobileMenu = document.querySelector('.mobile-menu');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const open = hamburger.classList.toggle('open');
      mobileMenu.classList.toggle('open', open);
      document.body.style.overflow = open ? 'hidden' : '';
    });

    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        mobileMenu.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  }

  /* ── Sticky nav shrink ── */
  const nav = document.querySelector('nav');
  if (nav) {
    window.addEventListener('scroll', () => {
      nav.style.padding = window.scrollY > 60
        ? (window.innerWidth > 768 ? '6px 60px' : '6px 24px')
        : (window.innerWidth > 768 ? '8px 60px' : '8px 24px');
    }, { passive: true });
  }

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

  /* ── Newsletter form ── */
  document.querySelectorAll('.newsletter-form').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      if (!input || !input.value) return;
      const success = form.closest('section, .newsletter')?.querySelector('.newsletter-success');
      form.style.display = 'none';
      const fine = form.closest('section, .newsletter')?.querySelector('.newsletter-fine');
      if (fine) fine.style.display = 'none';
      if (success) success.style.display = 'block';
    });
  });

  /* ── Inquiry forms — submit to Netlify silently, show success message ── */
  document.querySelectorAll('.inquiry-form').forEach(form => {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const data = new FormData(form);
      try {
        await fetch('/', { method: 'POST', body: data });
      } catch (_) { /* network error — still show success */ }
      const card = form.closest('.form-card');
      form.style.display = 'none';
      if (card) {
        const success = card.querySelector('.form-success');
        if (success) success.style.display = 'block';
      }
    });
  });

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

  /* ── Smooth scroll for anchor links ── */
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

})();
