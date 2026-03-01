// Core Exteriors - Interactive JavaScript
document.addEventListener('DOMContentLoaded', () => {
    // Mobile Menu Toggle
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const navLinks = document.getElementById('navLinks');

    if (mobileMenuToggle && navLinks) {
        mobileMenuToggle.addEventListener('click', () => {
            navLinks.classList.toggle('active');
            mobileMenuToggle.classList.toggle('active');
        });

        // Close menu when clicking a link
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('active');
                mobileMenuToggle.classList.remove('active');
            });
        });
    }

    // Language Toggle (English/French) - Google Translate Integration
    const langToggleEN = document.getElementById('langToggleEN');
    const langToggleFR = document.getElementById('langToggleFR');

    // Load Google Translate script dynamically
    function loadGoogleTranslate() {
        const script = document.createElement('script');
        script.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
        document.body.appendChild(script);
    }

    // Initialize Google Translate
    window.googleTranslateElementInit = function () {
        new google.translate.TranslateElement({
            pageLanguage: 'en',
            includedLanguages: 'en,fr',
            layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
            autoDisplay: false
        }, 'google_translate_element');
    };

    // Load translate script
    loadGoogleTranslate();

    // Helper function to switch language
    function switchLanguage(targetLang) {
        const frame = document.querySelector('.goog-te-menu-frame');
        if (frame) {
            const frameDoc = frame.contentDocument || frame.contentWindow.document;
            const items = frameDoc.querySelectorAll('.goog-te-menu2-item span.text');

            items.forEach(item => {
                if (targetLang === 'fr' && item.textContent === 'French') {
                    item.click();
                } else if (targetLang === 'en' && item.textContent === 'English') {
                    item.click();
                }
            });
        } else {
            // Fallback: Toggle using cookie
            if (targetLang === 'fr') {
                document.cookie = 'googtrans=/en/fr; path=/';
            } else {
                document.cookie = 'googtrans=/en/en; path=/';
            }
            window.location.reload();
        }
    }

    // Update active states
    function updateLangButtons(activeLang) {
        if (langToggleEN && langToggleFR) {
            if (activeLang === 'en') {
                langToggleEN.classList.add('active');
                langToggleFR.classList.remove('active');
            } else {
                langToggleFR.classList.add('active');
                langToggleEN.classList.remove('active');
            }
        }
    }

    // English button click
    if (langToggleEN) {
        langToggleEN.addEventListener('click', () => {
            switchLanguage('en');
            updateLangButtons('en');
        });
    }

    // French button click
    if (langToggleFR) {
        langToggleFR.addEventListener('click', () => {
            switchLanguage('fr');
            updateLangButtons('fr');
        });
    }

    // Check initial state (from cookie)
    const googTransCookie = document.cookie.split(';').find(c => c.trim().startsWith('googtrans='));
    if (googTransCookie && googTransCookie.includes('/fr')) {
        updateLangButtons('fr');
    } else {
        updateLangButtons('en');
    }

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Intersection Observer for scroll animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.animationPlayState = 'running';
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Observe service cards for scroll animation
    document.querySelectorAll('.service-card').forEach(card => {
        card.style.animationPlayState = 'paused';
        observer.observe(card);
    });

    // Header scroll behavior - add shadow on scroll
    const header = document.querySelector('.header');
    let lastScroll = 0;

    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;

        if (currentScroll > 50) {
            header.style.boxShadow = '0 4px 20px rgba(0,0,0,0.15)';
        } else {
            header.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
        }

        lastScroll = currentScroll;
    });

    // Testimonials Carousel
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const track = document.querySelector('.testimonials-track');

    if (prevBtn && nextBtn && track) {
        const cards = track.querySelectorAll('.testimonial-card');
        let currentIndex = 0;
        let cardsToShow = window.innerWidth <= 600 ? 1 : window.innerWidth <= 900 ? 2 : 3;
        let maxIndex = Math.max(0, cards.length - cardsToShow);
        let autoPlayInterval;
        let direction = 1; // 1 = forward, -1 = backward (for ping-pong effect)

        function updateCarousel() {
            const cardWidth = cards[0].offsetWidth + 24; // card width + gap
            track.style.transform = `translateX(-${currentIndex * cardWidth}px)`;
        }

        function nextSlide() {
            if (currentIndex >= maxIndex) {
                currentIndex = 0; // Loop back to start
            } else {
                currentIndex++;
            }
            updateCarousel();
        }

        function prevSlide() {
            if (currentIndex <= 0) {
                currentIndex = maxIndex; // Loop to end
            } else {
                currentIndex--;
            }
            updateCarousel();
        }

        // Ping-pong auto-slide: cycles forward then backward in a loop
        function autoSlide() {
            currentIndex += direction;

            // Reverse direction at boundaries
            if (currentIndex >= maxIndex) {
                currentIndex = maxIndex;
                direction = -1; // Start going backward
            } else if (currentIndex <= 0) {
                currentIndex = 0;
                direction = 1; // Start going forward
            }

            updateCarousel();
        }

        // Auto-play functionality with ping-pong effect
        function startAutoPlay() {
            autoPlayInterval = setInterval(autoSlide, 5000); // Cycle every 5 seconds
        }

        function stopAutoPlay() {
            clearInterval(autoPlayInterval);
        }

        // Start auto-play on page load
        startAutoPlay();

        // Pause on hover
        const carouselContainer = document.getElementById('testimonialsCarousel');
        if (carouselContainer) {
            carouselContainer.addEventListener('mouseenter', stopAutoPlay);
            carouselContainer.addEventListener('mouseleave', startAutoPlay);
        }

        prevBtn.addEventListener('click', () => {
            stopAutoPlay();
            prevSlide();
            startAutoPlay();
        });

        nextBtn.addEventListener('click', () => {
            stopAutoPlay();
            nextSlide();
            startAutoPlay();
        });

        // Update on window resize
        window.addEventListener('resize', () => {
            cardsToShow = window.innerWidth <= 600 ? 1 : window.innerWidth <= 900 ? 2 : 3;
            maxIndex = Math.max(0, cards.length - cardsToShow);
            currentIndex = Math.min(currentIndex, maxIndex);
            updateCarousel();
        });
    }

    // FAQ Accordion
    const faqItems = document.querySelectorAll('.faq-item');

    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');

        question.addEventListener('click', () => {
            const isActive = item.classList.contains('active');

            // Close all other items
            faqItems.forEach(otherItem => {
                otherItem.classList.remove('active');
            });

            // Toggle current item
            if (!isActive) {
                item.classList.add('active');
            }
        });
    });

    // Quote Form Submission
    const quoteForm = document.getElementById('quoteForm');

    if (quoteForm) {
        quoteForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const formData = new FormData(quoteForm);
            const leadData = {
                name: formData.get('name'),
                phone: formData.get('phone'),
                email: formData.get('email'),
                service: formData.get('service'),
                source: window.location.pathname.split('/').pop() || 'index.html'
            };

            try {
                if (window.crmService) {
                    await window.crmService.saveLead(leadData);
                }
                alert('Thank you! We will contact you within 24 hours.');
                quoteForm.reset();
            } catch (error) {
                console.error('Error saving lead:', error);
                alert('There was an error sending your request. Please try again or call us directly.');
            }
        });
    }

    // ==========================================
    // Scoped Lightbox & Zoom Functionality
    // ==========================================

    // Create Lightbox Elements if not present
    if (!document.querySelector('.lightbox')) {
        const lightbox = document.createElement('div');
        lightbox.className = 'lightbox';
        lightbox.innerHTML = `
            <button class="lightbox-nav lightbox-prev" aria-label="Previous image">&#10094;</button>
            <div class="lightbox-content">
                <button class="lightbox-close" aria-label="Close lightbox">&times;</button>
                <img src="" alt="" class="lightbox-image">
                <div class="lightbox-label"></div>
            </div>
            <button class="lightbox-nav lightbox-next" aria-label="Next image">&#10095;</button>
            <div class="lightbox-counter"></div>
        `;
        document.body.appendChild(lightbox);
    }

    const lightbox = document.querySelector('.lightbox');
    const lightboxImg = lightbox.querySelector('.lightbox-image');
    const lightboxLabel = lightbox.querySelector('.lightbox-label');
    const lightboxClose = lightbox.querySelector('.lightbox-close');
    const lightboxPrev = lightbox.querySelector('.lightbox-prev');
    const lightboxNext = lightbox.querySelector('.lightbox-next');
    const lightboxCounter = lightbox.querySelector('.lightbox-counter');

    let currentImages = []; // Scoped list of images
    let currentIndex = 0;

    // Open Lightbox Function
    function openLightbox(images, index) {
        currentImages = images;
        currentIndex = index;
        updateLightboxContent();
        lightbox.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }

    // Update Lightbox Content
    function updateLightboxContent() {
        const image = currentImages[currentIndex];
        lightboxImg.src = image.src;
        lightboxImg.alt = image.alt;
        lightboxLabel.textContent = image.label;

        // Reset Zoom
        lightboxImg.classList.remove('zoomed');

        // Manage Navigation Buttons
        if (currentImages.length > 1) {
            lightboxPrev.style.display = 'block';
            lightboxNext.style.display = 'block';
            lightboxCounter.textContent = `${currentIndex + 1} / ${currentImages.length}`;
        } else {
            lightboxPrev.style.display = 'none';
            lightboxNext.style.display = 'none';
            lightboxCounter.textContent = '';
        }
    }

    // Event Listeners for Gallery Images (Home & Gallery Pages)
    // Selects both .gallery-card images (Home) and .photo-card images (Gallery)
    const galleryImages = document.querySelectorAll('.gallery-card img, .photo-card img');

    galleryImages.forEach(img => {
        img.style.cursor = 'pointer'; // Indicate clickable
        img.addEventListener('click', function (e) {
            e.preventDefault(); // Prevent default link behavior if any

            // 1. Determine Scope (Before/After container or entire card)
            // We want to scope primarily to .before-after or .image-slot siblings
            let container = this.closest('.before-after');

            // If not in a before-after container (e.g., single image card), use the card itself
            if (!container) {
                container = this.closest('.gallery-card, .photo-card');
            }

            if (!container) return; // Should not happen based on selector

            // 2. Collect Images within Scope
            const scopedImgs = container.querySelectorAll('img');
            const imagesList = [];
            let clickedIndex = 0;

            scopedImgs.forEach((scopedImg, index) => {
                // Determine Label
                let label = '';
                const cardLabel = scopedImg.closest('.gallery-card, .photo-card').querySelector('.gallery-label, .photo-card-label')?.textContent || '';
                const dataLabel = scopedImg.dataset.label;

                if (dataLabel) {
                    label = dataLabel;
                } else {
                    // Fallback logic
                    const isBefore = scopedImg.closest('.image-slot')?.classList.contains('before');
                    const isAfter = scopedImg.closest('.image-slot')?.classList.contains('after');
                    if (isBefore) label = cardLabel + ' - Before';
                    else if (isAfter) label = cardLabel + ' - After';
                    else label = cardLabel;
                }

                if (scopedImg === this) {
                    clickedIndex = index;
                }

                imagesList.push({
                    src: scopedImg.src,
                    alt: scopedImg.alt,
                    label: label
                });
            });

            // 3. Open Lightbox with Scoped List
            openLightbox(imagesList, clickedIndex);
        });
    });

    // Close Lightbox
    lightboxClose.addEventListener('click', () => {
        lightbox.classList.remove('active');
        document.body.style.overflow = '';
    });

    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            lightbox.classList.remove('active');
            document.body.style.overflow = '';
        }
    });

    // Navigation Events
    lightboxPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        currentIndex = (currentIndex - 1 + currentImages.length) % currentImages.length;
        updateLightboxContent();
    });

    lightboxNext.addEventListener('click', (e) => {
        e.stopPropagation();
        currentIndex = (currentIndex + 1) % currentImages.length;
        updateLightboxContent();
    });

    // Keyboard Navigation
    document.addEventListener('keydown', (e) => {
        if (!lightbox.classList.contains('active')) return;

        if (e.key === 'Escape') {
            lightbox.classList.remove('active');
            document.body.style.overflow = '';
        } else if (e.key === 'ArrowLeft') {
            currentIndex = (currentIndex - 1 + currentImages.length) % currentImages.length;
            updateLightboxContent();
        } else if (e.key === 'ArrowRight') {
            currentIndex = (currentIndex + 1) % currentImages.length;
            updateLightboxContent();
        }
    });

    // Zoom Functionality
    lightboxImg.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent closing lightbox
        lightboxImg.classList.toggle('zoomed');
    });

    // ==========================================
    // Video Gallery Enhancements
    // ==========================================

    const videoCards = document.querySelectorAll('.video-card');

    videoCards.forEach(card => {
        const video = card.querySelector('.gallery-video');
        const overlay = card.querySelector('.video-play-overlay');

        if (video && overlay) {
            // Hide overlay when video plays
            video.addEventListener('play', () => {
                overlay.style.opacity = '0';
            });

            // Show overlay when video pauses
            video.addEventListener('pause', () => {
                overlay.style.opacity = '';
            });

            // Show overlay when video ends
            video.addEventListener('ended', () => {
                overlay.style.opacity = '';
            });

            // Click overlay to play video
            overlay.addEventListener('click', () => {
                video.play();
            });

            // Double-tap to zoom functionality
            let lastTap = 0;
            let isZoomed = false;

            video.addEventListener('click', (e) => {
                const currentTime = new Date().getTime();
                const tapLength = currentTime - lastTap;

                // Double tap detected (within 300ms)
                if (tapLength < 300 && tapLength > 0) {
                    e.preventDefault();

                    if (!isZoomed) {
                        // Zoom in
                        video.style.transform = 'scale(1.5)';
                        video.style.cursor = 'zoom-out';
                        isZoomed = true;
                    } else {
                        // Zoom out
                        video.style.transform = 'scale(1)';
                        video.style.cursor = 'pointer';
                        isZoomed = false;
                    }
                }

                lastTap = currentTime;
            });
        }
    });

    // ==========================================
    // Smooth Page Transitions
    // ==========================================

    // Add smooth transition when clicking navigation links
    document.querySelectorAll('a[href]').forEach(link => {
        // Skip anchor links and external links
        if (link.getAttribute('href').startsWith('#') ||
            link.getAttribute('href').startsWith('http') ||
            link.getAttribute('href').startsWith('mailto') ||
            link.getAttribute('href').startsWith('tel')) {
            return;
        }

        link.addEventListener('click', function (e) {
            const href = this.getAttribute('href');

            // Only apply to internal page navigation
            if (href && !href.startsWith('#')) {
                e.preventDefault();

                // Add exit animation
                document.body.classList.add('page-exit');

                // Navigate after animation
                setTimeout(() => {
                    window.location.href = href;
                }, 300);
            }
        });
    });
});
