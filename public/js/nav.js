document.addEventListener('DOMContentLoaded', function() {
    
    // Pega o caminho completo da URL, ex: "/" ou "/html/regulacao.html"
    const currentPath = window.location.pathname;

    const navLinks = document.querySelectorAll('.main-nav a');

    navLinks.forEach(link => {
        // Pega o href do link, ex: "/" ou "/html/regulacao.html"
        const linkPath = link.getAttribute('href');

        // Lógica especial para a Home ("Início")
        if (linkPath === '/') {
            // A Home pode ser "/", "/index.html" ou "/html/index.html"
            if (currentPath === '/' || currentPath === '/index.html' || currentPath === '/html/index.html') {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        }
        // Lógica para as outras páginas
        else {
            // Compara se o caminho da URL é o mesmo do link
            if (currentPath === linkPath) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        }
    });
});
