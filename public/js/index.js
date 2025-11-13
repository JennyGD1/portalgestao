function animateStats() {
    const statNumbers = document.querySelectorAll('.stat-number');
    
    statNumbers.forEach(stat => {
        const target = parseInt(stat.getAttribute('data-target'));
        const duration = 2000; // 2 segundos
        const step = target / (duration / 16); // 60fps
        let current = 0;
        
        const timer = setInterval(() => {
            current += step;
            if (current >= target) {
                current = target;
                clearInterval(timer);
            }
            
            if (stat.getAttribute('data-target').includes('.')) {
                stat.textContent = current.toFixed(1);
            } else {
                stat.textContent = Math.floor(current);
            }
        }, 16);
    });
}

function typeWriter(element, text, speed = 50) {
    let i = 0;
    element.innerHTML = '';
    
    function type() {
        if (i < text.length) {
            element.innerHTML += text.charAt(i);
            i++;
            setTimeout(type, speed);
        }
    }
    type();
}

// Nova função para animar a logo
function animateLogo() {
    const logo = document.getElementById('main-logo');
    if (logo) {
        // Primeiro garante que a imagem foi carregada
        logo.addEventListener('load', function() {
            setTimeout(() => {
                logo.classList.add('fade-in');
            }, 500);
        });
        
        // Fallback caso a imagem já esteja em cache
        if (logo.complete) {
            setTimeout(() => {
                logo.classList.add('fade-in');
            }, 500);
        }
    }
}

// Função para pré-carregar a logo
function preloadLogo() {
    const logo = document.getElementById('main-logo');
    if (logo) {
        const img = new Image();
        img.src = logo.src;
        img.onload = function() {
            logo.classList.add('loaded');
        };
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // Pré-carrega e anima a logo
    preloadLogo();
    animateLogo();
    
    // Anima as estatísticas
    animateStats();
    
    // Efeito de digitação no subtítulo
    const subtitle = document.querySelector('.subtitle');
    if (subtitle) {
        const originalText = subtitle.textContent;
        // Espera a animação da logo terminar antes de começar o typewriter
        setTimeout(() => {
            typeWriter(subtitle, originalText);
        }, 1500);
    }
    
    // Efeito de hover nos cards
    const cards = document.querySelectorAll('.module-card, .benefit-card');
    cards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-5px)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    });
    
    // Loading overlay para links
    const links = document.querySelectorAll('a[href]');
    links.forEach(link => {
        link.addEventListener('click', function(e) {
            if (this.getAttribute('href') !== '#' && !this.getAttribute('href').includes('javascript')) {
                const loadingOverlay = document.getElementById('loading-overlay');
                if (loadingOverlay) {
                    loadingOverlay.style.display = 'flex';
                    
                    // Esconde o loading após 2 segundos (fallback)
                    setTimeout(() => {
                        loadingOverlay.style.display = 'none';
                    }, 2000);
                }
            }
        });
    });
    
    // Esconde o loading quando a página terminar de carregar
    window.addEventListener('load', function() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }
    });
});

// Função para mostrar/ocultar loading
function showLoading() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'flex';
    }
}

function hideLoading() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
    }
}
