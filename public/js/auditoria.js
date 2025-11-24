// Registra o plugin de labels para os gráficos
Chart.register(ChartDataLabels);

const API_URL = '/api/auditoria/dashboard';
const loadingOverlay = document.getElementById('loading-overlay');

// --- Cores Padrão (Idênticas à Regulação) ---
const CORES_VIBRANTES = [
    '#0070ff', // Azul Maida
    '#ff0073', // Rosa Maida
    '#ffcc00', // Amarelo Maida
    '#34c759', // Verde
    '#5856d6', // Roxo
    '#ff9500', // Laranja
    '#ff2d55', // Vermelho Rosado
    '#5ac8fa', // Azul Claro
    '#4cd964', // Verde Claro
    '#585958'  // Cinza
];

// --- Funções Utilitárias ---
const formatCurrency = (val) => {
    return new Intl.NumberFormat('pt-BR', { 
        style: 'currency', 
        currency: 'BRL' 
    }).format(val || 0);
};

const formatNumber = (val) => {
    return new Intl.NumberFormat('pt-BR').format(val || 0);
};

function showLoading() { if(loadingOverlay) loadingOverlay.style.display = 'flex'; }
function hideLoading() { if(loadingOverlay) loadingOverlay.style.display = 'none'; }

// Inicialização de datas
const today = new Date();
const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
const formatDateInput = (date) => date.toISOString().split('T')[0];
document.getElementById('start-date').value = formatDateInput(firstDay);
document.getElementById('end-date').value = formatDateInput(today);

// Variáveis globais
let chartPrestadores = null;
let chartMotivos = null;
let chartItens = null;
let chartAuditores = null;
let chartEficiencia = null;
let chartEvolucao = null;

// --- PLUGIN CUSTOMIZADO: SETAS E LEGENDAS (Com Anti-Colisão) ---
const pluginSetasLegendas = {
    id: 'setasLegendasDistribuidas',
    afterDraw: function(chart) {
        if (chart.config.type !== 'doughnut') return;

        const ctx = chart.ctx;
        const meta = chart.getDatasetMeta(0);
        const total = chart.data.datasets[0].data.reduce((a, b) => a + b, 0);

        ctx.save();
        ctx.font = '11px Inter, sans-serif';
        ctx.textBaseline = 'middle';

        const centerX = chart.chartArea.left + (chart.chartArea.width / 2);
        const centerY = chart.chartArea.top + (chart.chartArea.height / 2);
        const radius = Math.min(chart.chartArea.width, chart.chartArea.height) / 2;

        const itemsToDraw = [];

        // 1. Calcular posições iniciais de todos os itens
        meta.data.forEach((element, index) => {
            const value = chart.data.datasets[0].data[index];
            
            // Ignora fatias muito pequenas (< 1%) para limpar o visual
            if (value / total < 0.01) return;

            const model = element;
            const angle = model.startAngle + (model.endAngle - model.startAngle) / 2;
            const cosAngle = Math.cos(angle);
            const sinAngle = Math.sin(angle);

            // Ponto de saída na borda do donut
            const startX = centerX + cosAngle * radius;
            const startY = centerY + sinAngle * radius;

            // Ponto do Cotovelo (mais afastado para dar espaço)
            const elbowRadius = radius + 30; 
            const elbowX = centerX + cosAngle * elbowRadius;
            const elbowY = centerY + sinAngle * elbowRadius;

            // Define lado (Direita ou Esquerda)
            const isRight = cosAngle >= 0;
            const textAlign = isRight ? 'left' : 'right';

            itemsToDraw.push({
                index,
                value,
                label: chart.data.labels[index],
                color: chart.data.datasets[0].backgroundColor[index % chart.data.datasets[0].backgroundColor.length],
                isRight,
                startX,
                startY,
                elbowX,
                elbowY,
                finalY: elbowY, // Posição Y final (será ajustada se houver colisão)
                textAlign
            });
        });

        // 2. Ajuste de Colisão Vertical (Evita sobreposição)
        // Separa itens da esquerda e direita e ordena por Y (de cima para baixo)
        const leftItems = itemsToDraw.filter(i => !i.isRight).sort((a, b) => a.finalY - b.finalY);
        const rightItems = itemsToDraw.filter(i => i.isRight).sort((a, b) => a.finalY - b.finalY);

        const adjustPositions = (items) => {
            const minSpacing = 28; // Distância mínima vertical entre legendas
            for (let i = 1; i < items.length; i++) {
                const prev = items[i - 1];
                const curr = items[i];
                
                // Se estiver muito perto do anterior, empurra para baixo
                if (curr.finalY - prev.finalY < minSpacing) {
                    curr.finalY = prev.finalY + minSpacing;
                }
            }
        };

        adjustPositions(leftItems);
        adjustPositions(rightItems);

        // 3. Desenhar linhas e textos com as posições ajustadas
        itemsToDraw.forEach(item => {
            const lineEndLength = 15; // Comprimento da linha horizontal final
            
            // Calcula X final da linha horizontal
            // A linha vai fazer: Start -> (elbowX, finalY) -> (endX, finalY)
            // Usamos o finalY ajustado no "cotovelo" para suavizar
            const endX = item.isRight ? item.elbowX + lineEndLength : item.elbowX - lineEndLength;
            const textX = item.isRight ? endX + 5 : endX - 5;

            // Linha
            ctx.beginPath();
            ctx.strokeStyle = item.color;
            ctx.lineWidth = 1.5;
            ctx.moveTo(item.startX, item.startY);
            ctx.lineTo(item.elbowX, item.finalY); // Vai até a altura ajustada
            ctx.lineTo(endX, item.finalY);        // Traço horizontal
            ctx.stroke();

            // Bolinha
            ctx.beginPath();
            ctx.arc(endX, item.finalY, 2.5, 0, 2 * Math.PI);
            ctx.fillStyle = item.color;
            ctx.fill();

            // Texto - REMOVENDO O CORTE DE TEXTO
            ctx.textAlign = item.textAlign;
            ctx.fillStyle = '#585958';
            
            const percent = ((item.value / total) * 100).toFixed(1);

            ctx.font = 'bold 11px Inter';
            ctx.fillText(item.label, textX, item.finalY - 7); // Use item.label diretamente
            
            ctx.font = 'normal 10px Inter';
            ctx.fillText(`${percent}%`, textX, item.finalY + 7);
        });

        ctx.restore();
    }
};

// --- Configurações Comuns para Todos os Gráficos ---
const configComum = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: { display: false },
        tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            padding: 12,
            cornerRadius: 8,
            callbacks: {
                label: function(context) {
                    let label = context.dataset.label || '';
                    if (label) label += ': ';
                    if (context.parsed.x !== undefined) {
                        label += formatCurrency(context.parsed.x);
                    }
                    if (context.parsed.y !== undefined) {
                        label += formatCurrency(context.parsed.y);
                    }
                    if (context.parsed.r !== undefined) {
                        label += formatCurrency(context.parsed.r);
                    }
                    return label;
                }
            }
        }
    }
};

// --- Carregamento de Dados ---
async function carregarDados() {
    showLoading();
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;

    try {
        const response = await fetch(`${API_URL}?startDate=${startDate}&endDate=${endDate}`);
        const json = await response.json();

        if (json.success) {
            atualizarKPIs(json.kpis);
            renderizarGraficos(json.charts);
        } else {
            alert('Erro: ' + json.error);
        }
    } catch (e) { console.error(e); } 
    finally { hideLoading(); }
}

function atualizarKPIs(kpis) {
    const kpiData = [
        { 
            id: 'kpi-apresentado', 
            value: formatCurrency(kpis.totalApresentado),
            label: 'Valor Total Apresentado',
            trend: 'neutral'
        },
        { 
            id: 'kpi-glosado', 
            value: formatCurrency(kpis.totalGlosado),
            label: 'Valor Total Glosado',
            trend: kpis.totalGlosado > 0 ? 'up' : 'neutral'
        },
        { 
            id: 'kpi-contas', 
            value: formatNumber(kpis.countGuias),
            label: 'Total de Guias Auditadas',
            trend: 'neutral'
        },
        { 
            id: 'kpi-glosa-media', 
            value: formatCurrency(kpis.glosaMediaInternamento),
            label: 'Glosa Média por Internação',
            trend: 'neutral'
        },
        { 
            id: 'kpi-custo-medio', 
            value: formatCurrency(kpis.custoMedioInternamento),
            label: 'Custo Médio por Internação',
            trend: 'neutral'
        },
        { 
            id: 'kpi-tempo-medio', 
            value: `${parseFloat(kpis.tempoMedioInternamento || 0).toFixed(1)} dias`,
            label: 'Tempo Médio de Internação',
            trend: 'neutral'
        }
    ];

    kpiData.forEach(kpi => {
        const element = document.getElementById(kpi.id);
        if (element) {
            element.textContent = kpi.value;
            // Adiciona classe de tendência se necessário
            const parent = element.closest('.kpi-card');
            if (parent) {
                parent.className = `kpi-card ${kpi.trend}`;
            }
        }
        
        // Atualiza o label se existir
        const labelElement = document.getElementById(`${kpi.id}-label`);
        if (labelElement) {
            labelElement.textContent = kpi.label;
        }
    });
}

// --- Renderização dos Gráficos ---
function renderizarGraficos(chartsData) {
    
    // 1. TOP PRESTADORES 
    if (chartPrestadores) chartPrestadores.destroy();
    chartPrestadores = new Chart(document.getElementById('chart-prestadores'), {
        type: 'bar',
        data: {
            labels: chartsData.prestadores.map(p => p.nome),
            datasets: [{
                label: 'Valor Glosado',
                data: chartsData.prestadores.map(p => p.glosa),
                backgroundColor: CORES_VIBRANTES[1],
                borderRadius: 6,
                borderWidth: 0
            }]
        },
        options: {
            ...configComum,
            indexAxis: 'y',
            layout: {
                padding: {
                    left: 5,
                    right: 120, 
                    top: 20,   
                    bottom: 20  
                }
            },
            scales: {
                x: {
                    display: false,
                    title: { display: false },
                    grid: { display: false }
                },
                y: {
                    display: true,
                    grid: { display: false },
                    ticks: {
                        autoSkip: false,
                        maxRotation: 0,
                        minRotation: 0,
                        callback: function(value) {
                            const label = this.getLabelForValue(value);
                            if (label.length > 20) {
                                return label.substring(0, 20) + '...';
                            }
                            return label;
                        }
                    }
                }
            },
            plugins: {
                ...configComum.plugins,
                datalabels: {
                    display: true,
                    anchor: 'end',
                    align: 'right',
                    formatter: formatCurrency,
                    color: '#585958',
                    font: { 
                        weight: 'bold',
                        size: 11
                    },
                    clamp: false, // Permite que saia da área
                    clip: false   // Não corta os labels
                }
            }
        }
    });

    // 2. PRINCIPAIS MOTIVOS DE GLOSA
    if (chartMotivos) chartMotivos.destroy();

    const motivosLabels = chartsData.motivos.map(m => m.motivo);
    const motivosData = chartsData.motivos.map(m => m.valor);

    chartMotivos = new Chart(document.getElementById('chart-motivos'), {
        type: 'bar',
        data: {
            labels: motivosLabels,
            datasets: [{
                label: 'Valor Glosado',
                data: motivosData,
                backgroundColor: CORES_VIBRANTES[0],
                borderRadius: 6,
                borderWidth: 0
            }]
        },
        options: {
            ...configComum,
            indexAxis: 'y',
            layout: {
                padding: {
                    left: 5,
                    right: 120, 
                    top: 20,
                    bottom: 20
                }
            },
            scales: {
                x: {
                    display: false,
                    title: { display: false },
                    grid: { display: false }
                },
                y: {
                    display: true,
                    grid: { display: false },
                    ticks: {
                        autoSkip: false,
                        maxRotation: 0,
                        minRotation: 0,
                        callback: function(value) {
                            const label = this.getLabelForValue(value);
                            if (label.length > 40) {
                                return label.substring(0, 40) + '...';
                            }
                            return label;
                        },
                        font: {
                            size: 11,
                            family: 'Inter, sans-serif'
                        },
                        padding: 8
                    }
                }
            },
            plugins: {
                ...configComum.plugins,
                datalabels: {
                    display: true,
                    anchor: 'end',
                    align: 'right',
                    formatter: formatCurrency,
                    color: '#585958',
                    font: { 
                        weight: 'bold',
                        size: 11
                    },
                    clamp: false,
                    clip: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.label}: ${formatCurrency(context.parsed.x)}`;
                        }
                    }
                }
            }
        }
    });


    // 3. DISTRIBUIÇÃO POR CATEGORIA 

    if (chartItens) chartItens.destroy();
    const dadosItens = chartsData.categorias
        .filter(i => i.glosado > 0)
        .sort((a,b) => b.glosado - a.glosado)
        .slice(0, 8);

    // Ordenar por valor glosado para melhor visualização no gráfico de linha
    dadosItens.sort((a, b) => a.glosado - b.glosado);

    // Função para quebrar labels longos em duas linhas
    function quebrarLabel(texto) {
        const palavras = texto.split(' ');
        if (palavras.length <= 2) return texto;
        
        const meio = Math.ceil(palavras.length / 2);
        const linha1 = palavras.slice(0, meio).join(' ');
        const linha2 = palavras.slice(meio).join(' ');
        
        return `${linha1}\n${linha2}`;
    }

    chartItens = new Chart(document.getElementById('chart-itens'), {
        type: 'line',
        data: {
            labels: dadosItens.map(i => 
                quebrarLabel(
                    i.tipo.replace(/_/g, ' ')
                        .replace('MEDICAMENTO', 'Medicamentos')
                        .replace('TAXAS', 'Taxas Hospitalares')
                        .replace('MATERIAIS', 'Materiais')
                        .replace('HONORARIOS', 'Honorários Médicos')
                        .replace('SADT', 'Procedimentos')
                        .replace('DIETAS', 'Dietas')
                        .replace('GASES', 'Gases Medicinais')
                        .replace('MATERIAIS_ESPECIAIS', 'Materiais Especiais')
                        .replace('PACOTES', 'Pacotes')
                )
            ),
            datasets: [{
                label: 'Valor Glosado por Categoria',
                data: dadosItens.map(i => i.glosado),
                borderColor: CORES_VIBRANTES[0],
                backgroundColor: CORES_VIBRANTES[0] + '20',
                tension: 0.3,
                fill: true,
                pointBackgroundColor: CORES_VIBRANTES[0],
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 6,
                pointHoverRadius: 8
            }]
        },
        options: {
            ...configComum,
            layout: {
                padding: {
                    top: 50,   
                    bottom: 5, 
                    left: 5,
                    right: 30
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        maxRotation: 0,
                        minRotation: 0,
                        callback: function(value, index, values) {
                            const label = this.getLabelForValue(value);
                            return label;
                        }
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    },
                    title: {
                        display: true,
                        text: 'Valor Glosado (R$)'
                    },
                    afterFit: function(scale) {
                        scale.height = scale.height + 60;
                    }
                }
            },
            plugins: {
                ...configComum.plugins,
                datalabels: {
                    display: true,
                    anchor: 'end',
                    align: 'top',
                    offset: 12, // Offset maior
                    formatter: formatCurrency,
                    color: '#585958',
                    font: { 
                        weight: 'bold',
                        size: 11
                    },
                    clamp: false, // Permite que saia da área
                    clip: false   // Não corta os labels
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const labelOriginal = context.label.replace(/\n/g, ' ');
                            return `${labelOriginal}: ${formatCurrency(context.parsed.y)}`;
                        }
                    }
                }
            }
        }
    });
    // 4. DESEMPENHO DOS AUDITORES
    if (chartAuditores) chartAuditores.destroy();
    chartAuditores = new Chart(document.getElementById('chart-auditores'), {
        type: 'bar',
        data: {
            labels: chartsData.auditores.map(a => a.nome),
            datasets: [{
                label: 'Valor Identificado em Glosas',
                data: chartsData.auditores.map(a => a.glosaTotal),
                backgroundColor: CORES_VIBRANTES[4],
                borderRadius: 6
            }]
        },
        options: {
            ...configComum,
            indexAxis: 'y',
            layout: {
                padding: {
                    left: 5,
                    right: 50 
                }
            },
            
            scales: {
                x: {
                    display: false, // Esconde o eixo X (números/título)
                    title: { display: false }, // Esconde o título do eixo X
                    grid: { display: false } // Esconde as linhas verticais
                },
                y: {
                    display: true,
                    grid: { display: false } // Esconde as linhas horizontais
                }
            },
            plugins: {
                ...configComum.plugins,
                datalabels: {
                    display: true,
                    anchor: 'end',
                    align: 'right',
                    formatter: formatCurrency,
                    color: '#585958',
                    font: { weight: 'bold' }
                }
            }
        }
    });

    // 5.  GRÁFICO: EFICIÊNCIA DA GLOSA POR CATEGORIA
    renderizarEficienciaGlosa(chartsData.categorias);

    
    // 7. GRÁFICO: EVOLUÇÃO TEMPORAL
    renderizarEvolucaoTemporal(chartsData.evolucao || []);
    renderizarDetalhamentoCategorias(chartsData.categorias || []);
}

// 5. GRÁFICO DE EFICIÊNCIA - Taxa de Glosa por Categoria
function renderizarEficienciaGlosa(categorias) {
    const ctx = document.getElementById('chart-eficiencia');
    if (!ctx) return;

    if (chartEficiencia) chartEficiencia.destroy();

    // 1. Filtrar e Calcular o Total de Glosa Geral 
    const categoriasComGlosa = categorias.filter(cat => (cat.glosado || 0) > 0);
    const totalGlosaGeral = categoriasComGlosa.reduce((sum, cat) => sum + cat.glosado, 0);

    if (totalGlosaGeral === 0) {
        // Se não houver glosa, não renderiza o gráfico (ou renderiza vazio)
        return; 
    }

    // 2. Calcular Percentual de Contribuição para a Glosa Total
    const dadosEficiencia = categoriasComGlosa
        .map(cat => ({
            categoria: cat.tipo.replace(/_/g, ' ')
                     .replace('MEDICAMENTO', 'Medicamentos')
                     .replace('TAXAS', 'Taxas')
                     .replace('MATERIAIS', 'Materiais')
                     .replace('HONORARIOS', 'Honorários')
                     .replace('SADT', 'Procedimentos')
                     .replace('DIETAS', 'Dietas')
                     .replace('GASES', 'Gases')
                     .replace('MATERIAIS_ESPECIAIS', 'Mat. Especiais')
                     .replace('PACOTES', 'Pacotes'),
            percentualGlosa: ((cat.glosado / totalGlosaGeral) * 100).toFixed(1),
            valorGlosado: cat.glosado
        }))
        .sort((a, b) => parseFloat(b.percentualGlosa) - parseFloat(a.percentualGlosa))
        .slice(0, 6);

    chartEficiencia = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dadosEficiencia.map(d => d.categoria),
            datasets: [{
                label: 'Contribuição para Glosa Total (%)',
                data: dadosEficiencia.map(d => parseFloat(d.percentualGlosa)),
                backgroundColor: CORES_VIBRANTES[2],
                borderRadius: 6,
                borderWidth: 0
            }]
        },
        options: {
            ...configComum,
            indexAxis: 'x',
            layout: {
                padding: {
                    top: 20,
                    bottom: 50, 
                    left: 5,
                    right: 5
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        maxRotation: 0, // LEGENDAS RETAS (mudei de 45 para 0)
                        minRotation: 0,  // LEGENDAS RETAS (mudei de 45 para 0)
                        autoSkip: false,
                        callback: function(value, index, values) {
                            const label = this.getLabelForValue(value);
                            // Quebrar labels muito longos em duas linhas
                            if (label.length > 20) {
                                const palavras = label.split(' ');
                                if (palavras.length > 2) {
                                    const meio = Math.ceil(palavras.length / 2);
                                    return palavras.slice(0, meio).join(' ') + '\n' + 
                                           palavras.slice(meio).join(' ');
                                }
                                return label.substring(0, 20) + '...';
                            }
                            return label;
                        },
                        font: {
                            size: 11 // Tamanho menor para caber melhor
                        }
                    }
                },
                y: {
                    display: false, // Esconde o eixo Y (números/título)
                    title: { display: false }, // Esconde o título do eixo Y
                    grid: { display: false }, // Esconde as linhas horizontais
                    beginAtZero: true,
                    max: 100 // Max de 100 para percentual
                }
            },
            plugins: {
                ...configComum.plugins,
                datalabels: {
                    display: true,
                    anchor: 'end',
                    align: 'top',
                    formatter: (value) => value + '%',
                    color: '#585958',
                    font: { 
                        weight: 'bold',
                        size: 11
                    },
                    clamp: false,
                    clip: false
                },
                tooltip: {
                    callbacks: {
                        afterLabel: function(context) {
                            const data = dadosEficiencia[context.dataIndex];
                            return `Valor glosado: ${formatCurrency(data.valorGlosado)}`;
                        }
                    }
                }
            }
        }
    });
}

// 7. GRÁFICO DE EVOLUÇÃO TEMPORAL
function renderizarEvolucaoTemporal(dadosEvolucao) {
    const ctx = document.getElementById('chart-evolucao');
    if (!ctx) return;

    if (chartEvolucao) chartEvolucao.destroy();

    let dados = dadosEvolucao;
    if (!dados || dados.length === 0) {
        const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const mesAtual = new Date().getMonth();
        dados = meses.slice(Math.max(0, mesAtual - 5), mesAtual + 1).map((mes, index) => ({
            mes,
            apresentado: 150000 + Math.random() * 50000,
            glosado: 20000 + Math.random() * 15000,
            guias: 80 + Math.floor(Math.random() * 40)
        }));
    }

    chartEvolucao = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dados.map(d => d.mes),
            datasets: [
                {
                    label: 'Valor Apresentado',
                    data: dados.map(d => d.apresentado),
                    borderColor: CORES_VIBRANTES[0],
                    backgroundColor: CORES_VIBRANTES[0] + '20',
                    tension: 0.4,
                    fill: true
                },
                {
                    label: 'Valor Glosado',
                    data: dados.map(d => d.glosado),
                    borderColor: CORES_VIBRANTES[1],
                    backgroundColor: CORES_VIBRANTES[1] + '20',
                    tension: 0.4,
                    fill: true
                }
            ]
        },
        options: {
            ...configComum,
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Valor (R$)' }
                }
            },
            plugins: {
                ...configComum.plugins,
                datalabels: {
                    display: false
                }
            }
        }
    });
}
// --- DETALHAMENTO POR CATEGORIA ---
function renderizarDetalhamentoCategorias(categorias) {
    const container = document.getElementById('categories-container');
    if (!container) return;

    // Calcular totais gerais para referência
    const totalApresentadoGeral = categorias.reduce((sum, cat) => sum + (cat.apresentado || 0), 0);
    const totalGlosadoGeral = categorias.reduce((sum, cat) => sum + (cat.glosado || 0), 0);
    const totalApuradoGeral = categorias.reduce((sum, cat) => sum + (cat.apurado || 0), 0);

    // Ordenar categorias por valor glosado (maior primeiro)
    const categoriasOrdenadas = categorias
        .filter(cat => (cat.apresentado || 0) > 0) // Só mostra categorias com valores
        .sort((a, b) => (b.glosado || 0) - (a.glosado || 0));

    let html = `
        <div class="categories-header">
            <div class="category-row header">
                <div class="category-name"><strong>Categoria</strong></div>
                <div class="category-values">
                    <div class="category-value"><strong>Total Apresentado</strong></div>
                    <div class="category-value"><strong>Total Aprovado</strong></div>
                    <div class="category-value"><strong>Total Glosado</strong></div>
                    <div class="category-value"><strong>% Aprovado</strong></div>
                    <div class="category-value"><strong>% Glosado</strong></div>
                </div>
            </div>
        </div>
        <div class="categories-body">
    `;

    categoriasOrdenadas.forEach(cat => {
        const apresentado = cat.apresentado || 0;
        const apurado = cat.apurado || 0;
        const glosado = cat.glosado || 0;
        
        // Calcular porcentagens
        const percentAprovado = apresentado > 0 ? ((apurado / apresentado) * 100).toFixed(1) : '0.0';
        const percentGlosado = apresentado > 0 ? ((glosado / apresentado) * 100).toFixed(1) : '0.0';

        // Formatar nome da categoria
        const nomeFormatado = formatarNomeCategoria(cat.tipo);

        html += `
            <div class="category-row">
                <div class="category-name">${nomeFormatado}</div>
                <div class="category-values">
                    <div class="category-value">${formatCurrency(apresentado)}</div>
                    <div class="category-value aprovado">${formatCurrency(apurado)}</div>
                    <div class="category-value glosado">${formatCurrency(glosado)}</div>
                    <div class="category-value percent aprovado">${percentAprovado}%</div>
                    <div class="category-value percent glosado">${percentGlosado}%</div>
                </div>
            </div>
        `;
    });

    const percentAprovadoGeral = totalApresentadoGeral > 0 ? 
        ((totalApuradoGeral / totalApresentadoGeral) * 100).toFixed(1) : '0.0';
    const percentGlosadoGeral = totalApresentadoGeral > 0 ? 
        ((totalGlosadoGeral / totalApresentadoGeral) * 100).toFixed(1) : '0.0';

    html += `
        </div>
        <div class="categories-footer">
            <div class="category-row total">
                <div class="category-name"><strong>TOTAL GERAL</strong></div>
                <div class="category-values">
                    <div class="category-value"><strong>${formatCurrency(totalApresentadoGeral)}</strong></div>
                    <div class="category-value aprovado"><strong>${formatCurrency(totalApuradoGeral)}</strong></div>
                    <div class="category-value glosado"><strong>${formatCurrency(totalGlosadoGeral)}</strong></div>
                    <div class="category-value percent aprovado"><strong>${percentAprovadoGeral}%</strong></div>
                    <div class="category-value percent glosado"><strong>${percentGlosadoGeral}%</strong></div>
                </div>
            </div>
        </div>
    `;

    container.innerHTML = html;
}

// Função auxiliar para formatar nomes de categorias
function formatarNomeCategoria(nome) {
    if (!nome) return 'N/A';
    
    return nome.replace(/_/g, ' ')
              .replace('MEDICAMENTO', 'Medicamentos')
              .replace('TAXAS', 'Taxas Hospitalares')
              .replace('MATERIAIS', 'Materiais')
              .replace('HONORARIOS', 'Honorários Médicos')
              .replace('SADT', 'Procedimentos')
              .replace('DIETAS', 'Dietas')
              .replace('GASES', 'Gases Medicinais')
              .replace('MATERIAIS_ESPECIAIS', 'Materiais Especiais')
              .replace('PACOTES', 'Pacotes')
              .replace('OUTROS', 'Outros');
}
// Event Listeners
document.getElementById('btn-update').addEventListener('click', carregarDados);
document.addEventListener('DOMContentLoaded', carregarDados);
