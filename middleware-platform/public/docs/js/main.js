// Smooth scroll and active nav link highlighting
document.addEventListener('DOMContentLoaded', function () {
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('.section');

    // Update active nav link on scroll
    function updateActiveNav() {
        let current = '';
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.clientHeight;
            if (window.pageYOffset >= sectionTop - 200) {
                current = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${current}`) {
                link.classList.add('active');
            }
        });
    }

    // Smooth scroll for nav links
    navLinks.forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            const targetSection = document.querySelector(targetId);
            if (targetSection) {
                targetSection.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
                // Update URL without jumping
                history.pushState(null, null, targetId);
            }
        });
    });

    // Update active nav on scroll
    window.addEventListener('scroll', updateActiveNav);
    updateActiveNav(); // Initial call

    // Handle browser back/forward buttons
    window.addEventListener('popstate', function (e) {
        const targetId = window.location.hash || '#overview';
        const targetSection = document.querySelector(targetId);
        if (targetSection) {
            targetSection.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });

    // Mobile menu toggle (if needed)
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', function () {
            document.getElementById('sidebar').classList.toggle('open');
        });
    }

    // Copy code blocks on click
    const codeBlocks = document.querySelectorAll('pre code');
    codeBlocks.forEach(block => {
        block.style.cursor = 'pointer';
        block.title = 'Click to copy';
        block.addEventListener('click', function () {
            const text = this.textContent;
            navigator.clipboard.writeText(text).then(() => {
                // Visual feedback
                const originalText = this.textContent;
                this.textContent = 'Copied!';
                setTimeout(() => {
                    this.textContent = originalText;
                }, 1000);
            }).catch(err => {
                console.error('Failed to copy:', err);
            });
        });
    });
});

