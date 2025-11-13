document.addEventListener('DOMContentLoaded', function() {
    
    const path = window.location.pathname;
    
    const currentPage = path.split('/').pop() || 'index.html';

    const navLinks = document.querySelectorAll('.main-nav a');

    navLinks.forEach(link => {
        const linkPage = link.getAttribute('href');

        if (linkPage === currentPage) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
});
