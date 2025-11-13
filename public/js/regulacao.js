// Registra o plugin de labels do Chart.js
Chart.register(ChartDataLabels);

// --- Configurações Globais ---
const API_BASE_URL = '/api';
let guiasData = [];
const loadingOverlay = document.getElementById('loading-overlay');

// Paginação
let currentPage = 1;
const itemsPerPage = 10;

// Armazenamento de instâncias de gráficos
let topPrestadoresChart = null;
let tiposGuiaChart = null;
let topNegadosChart = null;
let slaTipoChart = null;
let slaVolumeChart = null;
let slaComparativoChart = null;
let slaTendenciaChart = null;
let reguladorSlaChart = null;
let reguladorVolumeChart = null;
// Modal
const detailsModal = document.getElementById('details-modal');
const closeModalBtn = document.querySelector('.close-btn');

// --- Funções de Utilidade ---

function showLoading() { loadingOverlay.style.display = 'flex'; }
function hideLoading() { loadingOverlay.style.display = 'none'; }

function formatCurrency(value) {
    if (typeof value === 'string') {
        value = parseFloat(value);
    }
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function createUrlParams() {
    const search = document.getElementById('search-guia').value;
    const startDate = document.getElementById('start-date-filter').value;
    const endDate = document.getElementById('end-date-filter').value;

    const searchParams = new URLSearchParams();
    if (search) searchParams.append('search', search);
    if (startDate) searchParams.append('startDate', startDate);
    if (endDate) searchParams.append('endDate', endDate);
    return searchParams.toString();
}

// --- Funções Principais de Dados e Gráficos ---

async function carregarDados() {
    showLoading();
    const params = createUrlParams();

    try {
        // 1. Busca estatísticas
        const statsResponse = await fetch(`${API_BASE_URL}/estatisticas?${params}`);
        const statsResult = await statsResponse.json();

        if (statsResult.success) {
            const stats = statsResult.data;
            
            document.getElementById('total-negado-geral').textContent = formatCurrency(stats.totalGeralNegado);
            document.getElementById('valor-medio-negado').textContent = formatCurrency(stats.valorMedio);
            document.getElementById('quantidade-guias').textContent = stats.quantidadeGuias;
            document.getElementById('maior-negativa-unica').textContent = formatCurrency(stats.maiorNegativa);
            
            criarGraficos(stats);
            
        } else {
            console.error('Erro nas estatísticas:', statsResult.error);
            criarGraficos({ topNegados: [], topPrestadores: [], topTiposGuia: [], totalGeralNegado: 0 });
        }


        // 2. Busca guias detalhadas
        const guiasResponse = await fetch(`${API_BASE_URL}/guias-negadas?${params}`);
        const guiasResult = await guiasResponse.json(); 

        if (guiasResult.success) {
            guiasData = guiasResult.data;
            document.getElementById('guias-titulo').textContent = `Guias com Negativa (${guiasResult.total} Encontradas)`;
            currentPage = 1;
            renderizarTabela(); 
            criarPaginacao();
        } else {
            console.error('Erro nas guias:', guiasResult.error);
        }

        try {
            const slaResponse = await fetch(`${API_BASE_URL}/sla-desempenho?${params}`);
            const slaResult = await slaResponse.json();

            if (slaResult.success) {
                console.log('✅ Dados de SLA e Reguladores carregados:', slaResult.data);
                
                document.getElementById('total-guias-sla').textContent = slaResult.data.totalGuiasSLA.toLocaleString('pt-BR');
                document.getElementById('sla-geral-percentual').textContent = slaResult.data.slaGeral + '%';
                
                criarGraficosSLA(slaResult.data); 
            } else {
                console.error('Erro nas estatísticas de SLA:', slaResult.error);
                document.getElementById('total-guias-sla').textContent = '0';
                document.getElementById('sla-geral-percentual').textContent = '0,0%';
            }
        } catch (slaError) {
             console.error('Erro ao buscar dados de SLA:', slaError);
        }

    } catch (error) {
        console.error('Erro ao buscar dados:', error);
        document.getElementById('guias-titulo').textContent = 'Erro ao carregar dados';
    } finally {
        hideLoading();
    }
}
function recriarCanvasSLA(id, wrapperId) {
    // Destrói instâncias anteriores
    if (id === 'grafico-sla-tipo' && slaTipoChart) slaTipoChart.destroy();
    if (id === 'grafico-sla-volume' && slaVolumeChart) slaVolumeChart.destroy();
    if (id === 'grafico-sla-comparativo' && slaComparativoChart) slaComparativoChart.destroy();
    if (id === 'grafico-sla-tendencia' && slaTendenciaChart) slaTendenciaChart.destroy();
    if (id === 'grafico-regulador-sla' && reguladorSlaChart) reguladorSlaChart.destroy();
    if (id === 'grafico-regulador-volume' && reguladorVolumeChart) reguladorVolumeChart.destroy();

    const wrapper = document.getElementById(wrapperId);
    if (wrapper) {
        wrapper.innerHTML = `<canvas id="${id}"></canvas>`;
    } else {
        console.error(`Wrapper ${wrapperId} não encontrado para o gráfico ${id}`);
    }
    return document.getElementById(id);
}
function criarGraficosSLA(data) {
    
    // Cores do exemplo
    const COR_AZUL = '#0070ff';
    const COR_ROSA = '#ff0073';
    const COR_AMARELO = '#ffcc00';
    const COR_CINZA = '#585958';
    
    // --- Dados por Tipo de Guia ---
    const dadosTipo = data.slaPorTipo || [];
    const labelsTipo = dadosTipo.map(item => item.tipo);
    const totalGeral = dadosTipo.reduce((sum, item) => sum + item.total, 0);

    // --- Dados de Tendência ---
    const dadosTendencia = data.tendenciaSLA || [];
    // Pega apenas os últimos 30 dias/pontos
    const dadosTendenciaFiltrados = dadosTendencia.slice(-12);
    const labelsTendencia = dadosTendenciaFiltrados.map(item => {
        // Formata data de YYYY-MM-DD para DD/MM
        const parts = item.data.split('-');
        return `${parts[2]}/${parts[1]}`;
    });
    const dataTendenciaSLA = dadosTendenciaFiltrados.map(item => item.percentualSLA);

    // --- Dados de Regulador ---
    const dadosRegulador = data.desempenhoReguladores || [];
    // Pega apenas o Top 15
    const topReguladores = dadosRegulador.slice(0, 15);
    const labelsRegulador = topReguladores.map(item => item.nome);

    // ----------------------------------------------------
    // GRÁFICO 1: SLA por Tipo de Guia (%) (Barra)
    // ----------------------------------------------------
    const ctxSla1 = recriarCanvasSLA('grafico-sla-tipo', 'chart-wrapper-sla-1').getContext('2d');
    if (dadosTipo.length > 0) {
        slaTipoChart = new Chart(ctxSla1, {
            type: 'bar',
            data: {
                labels: labelsTipo,
                datasets: [{
                    label: 'SLA (%)',
                    data: dadosTipo.map(item => parseFloat(item.percentualSLA)),
                    backgroundColor: COR_AZUL,
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: 'Percentual (%)' } } },
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        anchor: 'center', align: 'center', color: '#ffffff',
                        font: { weight: 'bold', size: 12 },
                        formatter: (value) => value + '%'
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    }

    // ----------------------------------------------------
    // GRÁFICO 2: Distribuição de Volume (Doughnut)
    // ----------------------------------------------------
    const ctxSla2 = recriarCanvasSLA('grafico-sla-volume', 'chart-wrapper-sla-2').getContext('2d');
    if (dadosTipo.length > 0) {
        slaVolumeChart = new Chart(ctxSla2, {
            type: 'doughnut',
            data: {
                labels: labelsTipo,
                datasets: [{
                    data: dadosTipo.map(item => item.total),
                    backgroundColor: [COR_AZUL, COR_ROSA, COR_AMARELO, COR_CINZA, '#9933ff', '#33cccc'],
                    borderColor: '#ffffff', borderWidth: 2
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { font: { size: 11 } } },
                    tooltip: {
                        callbacks: {
                            label: (context) => ` ${context.label}: ${context.parsed.toLocaleString()} guias`
                        }
                    },
                    datalabels: {
                        color: '#ffffff',
                        font: { weight: 'bold', size: 11 },
                        formatter: (value, context) => {
                            const percent = ((value / totalGeral) * 100).toFixed(1);
                            return percent + '%';
                        }
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    }

    // ----------------------------------------------------
    // GRÁFICO 3: Guias Dentro vs Fora do SLA (Barra Empilhada)
    // ----------------------------------------------------
    const ctxSla3 = recriarCanvasSLA('grafico-sla-comparativo', 'chart-wrapper-sla-3').getContext('2d');
    if (dadosTipo.length > 0) {
        slaComparativoChart = new Chart(ctxSla3, {
            type: 'bar',
            data: {
                labels: labelsTipo,
                datasets: [
                    { label: 'Dentro SLA', data: dadosTipo.map(item => item.dentroSLA), backgroundColor: COR_AZUL },
                    { label: 'Fora SLA', data: dadosTipo.map(item => item.foraSLA), backgroundColor: COR_ROSA }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: 'Quantidade de Guias' } } },
                plugins: {
                    datalabels: {
                        display: (context) => context.dataset.data[context.dataIndex] > (totalGeral * 0.05), // Só mostra se for > 5% do total
                        color: '#ffffff',
                        font: { weight: 'bold', size: 10 },
                        formatter: (value) => value.toLocaleString()
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    }

    // ----------------------------------------------------
    // GRÁFICO 4: Tendência de SLA (Linha)
    // ----------------------------------------------------
    const ctxSla4 = recriarCanvasSLA('grafico-sla-tendencia', 'chart-wrapper-sla-4').getContext('2d');
    if (dadosTendencia.length > 0) {
        slaTendenciaChart = new Chart(ctxSla4, {
            type: 'line',
            data: {
                labels: labelsTendencia,
                datasets: [{
                    label: 'SLA Diário',
                    data: dataTendenciaSLA,
                    borderColor: COR_AZUL,
                    backgroundColor: 'rgba(0, 112, 255, 0.1)',
                    borderWidth: 3,
                    tension: 0.2,
                    fill: true
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { y: { beginAtZero: false, min: 50, max: 100, title: { display: true, text: 'SLA (%)' } } },
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        align: 'top', anchor: 'end', color: COR_AZUL,
                        font: { weight: 'bold', size: 10 },
                        formatter: (value) => value.toFixed(1) + '%'
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    }

    // ----------------------------------------------------
    // GRÁFICO 5: Desempenho (SLA) por Regulador (Barra Horizontal)
    // ----------------------------------------------------
    const ctxReg1 = recriarCanvasSLA('grafico-regulador-sla', 'chart-wrapper-reg-1').getContext('2d');
    if (topReguladores.length > 0) {
        reguladorSlaChart = new Chart(ctxReg1, {
            type: 'bar',
            data: {
                labels: labelsRegulador,
                datasets: [{
                    label: 'SLA (%)',
                    data: topReguladores.map(item => parseFloat(item.percentualSLA)),
                    backgroundColor: COR_AZUL,
                }]
            },
            options: {
                indexAxis: 'y', // <-- Barra Horizontal
                responsive: true, maintainAspectRatio: false,
                scales: { x: { beginAtZero: true, max: 100, title: { display: true, text: 'Percentual (%)' } } },
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        anchor: 'center', align: 'center', color: '#ffffff',
                        font: { weight: 'bold', size: 12 },
                        formatter: (value) => value + '%'
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    }

    // ----------------------------------------------------
    // GRÁFICO 6: Volume por Regulador (Barra Horizontal)
    // ----------------------------------------------------
    const ctxReg2 = recriarCanvasSLA('grafico-regulador-volume', 'chart-wrapper-reg-2').getContext('2d');
    if (topReguladores.length > 0) {
        reguladorVolumeChart = new Chart(ctxReg2, {
            type: 'bar',
            data: {
                labels: labelsRegulador,
                datasets: [
                    { label: 'Dentro SLA', data: topReguladores.map(item => item.dentroSLA), backgroundColor: COR_AZUL },
                    { label: 'Fora SLA', data: topReguladores.map(item => item.foraSLA), backgroundColor: COR_ROSA }
                ]
            },
            options: {
                indexAxis: 'y', // <-- Barra Horizontal
                responsive: true, maintainAspectRatio: false,
                scales: { x: { stacked: true, title: { display: true, text: 'Volume de Guias' } }, y: { stacked: true } },
                plugins: {
                    legend: { position: 'bottom' },
                    datalabels: {
                        display: (context) => context.dataset.data[context.dataIndex] > 5, // Só mostra se for > 5
                        color: '#ffffff',
                        font: { weight: 'bold', size: 10 },
                        formatter: (value) => value.toLocaleString()
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    }
}

function recriarCanvas(id) {
    const wrapperIds = {
        'grafico-top-prestadores': 1,
        'grafico-tipos-guia': 2,
        'grafico-top-negados': 3
    };
    
    const wrapper = document.getElementById(`chart-wrapper-${wrapperIds[id]}`);
    if (wrapper) {
        wrapper.innerHTML = `<canvas id="${id}"></canvas>`;
    }
    return document.getElementById(id);
}

function criarGraficos(stats) {
    // Destrói instâncias anteriores
    if (topPrestadoresChart) topPrestadoresChart.destroy();
    if (tiposGuiaChart) tiposGuiaChart.destroy();
    if (topNegadosChart) topNegadosChart.destroy();

    // ----------------------------------------------------
    // GRÁFICO 1: TOP 10 PRESTADORES MAIS GLOSADOS (PRINCIPAL)
    // ----------------------------------------------------
    const ctx1 = recriarCanvas('grafico-top-prestadores').getContext('2d');
    
    if (stats.topPrestadores && stats.topPrestadores.length > 0) {
        const labelsPrestadores = stats.topPrestadores.map(item => {
            const nome = item.prestador || 'Prestador Não Informado';
            return nome.length > 25 ? nome.substring(0, 25) + '...' : nome;
        });
        const dadosPrestadores = stats.topPrestadores.map(item => parseFloat(item.totalNegado || 0));

        topPrestadoresChart = new Chart(ctx1, {
            type: 'bar',
            data: {
                labels: labelsPrestadores,
                datasets: [{
                    label: 'Valor Negado',
                    data: dadosPrestadores,
                    backgroundColor: 'rgba(255, 0, 115, 0.8)',
                    borderColor: 'rgba(255, 0, 115, 1)',
                    borderWidth: 1,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        beginAtZero: true,
                        title: { 
                            display: true, 
                            text: 'Valor Negado (R$)',
                            font: { size: 14 }
                        },
                        ticks: {
                            callback: function(value) {
                                return 'R$ ' + value.toLocaleString('pt-BR', {maximumFractionDigits: 0});
                            }
                        }
                    },
                    y: {
                        ticks: {
                            font: { size: 12 }
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    title: { 
                        display: true, 
                        text: 'Top 10 Prestadores por Valor Total Negado',
                        font: { size: 18 }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => `Valor Negado: ${formatCurrency(context.parsed.x)}`
                        }
                    },
                    datalabels: {
                        anchor: 'end',
                        align: 'right',
                        color: '#585958',
                        font: { weight: 'bold', size: 12 },
                        formatter: (value) => formatCurrency(value)
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    } else {
        ctx1.canvas.parentNode.innerHTML = 
            '<div style="display: flex; justify-content: center; align-items: center; height: 100%; color: #666;">Nenhum dado disponível</div>';
    }

    // ----------------------------------------------------
    // GRÁFICO 2: DISTRIBUIÇÃO POR TIPO DE GUIA (LEGENDA EMBAIXO)
    // ----------------------------------------------------
    const ctx2 = recriarCanvas('grafico-tipos-guia').getContext('2d');
    
    if (stats.topTiposGuia && stats.topTiposGuia.length > 0) {
        const labelsTipos = stats.topTiposGuia.map(item => {
            const tipo = item.tipoGuia || 'Tipo Não Informado';
            return tipo.length > 20 ? tipo.substring(0, 20) + '...' : tipo;
        });
        const dadosTipos = stats.topTiposGuia.map(item => parseFloat(item.totalNegado || 0));

        tiposGuiaChart = new Chart(ctx2, {
            type: 'doughnut',
            data: {
                labels: labelsTipos,
                datasets: [{
                    data: dadosTipos,
                    backgroundColor: [
                        '#0070ff', '#ff0073', '#ffcc00', '#34c759', '#5856d6',
                        '#ff9500', '#ff2d55', '#5ac8fa', '#4cd964', '#ff3b30'
                    ],
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom', // LEGENDA EMBAIXO
                        labels: { 
                            font: { size: 11 },
                            boxWidth: 12,
                            padding: 15
                        }
                    },
                    title: { 
                        display: true, 
                        text: 'Distribuição por Tipo de Guia',
                        font: { size: 16 }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const label = context.label || '';
                                const value = context.parsed;
                                const total = stats.totalGeralNegado;
                                const percent = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                                return `${label}: ${formatCurrency(value)} (${percent}%)`;
                            }
                        }
                    },
                    datalabels: {
                        color: '#ffffff',
                        font: { weight: 'bold', size: 11 },
                        formatter: (value, context) => {
                            const total = stats.totalGeralNegado;
                            const percent = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                            return percent + '%';
                        }
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    } else {
        ctx2.canvas.parentNode.innerHTML = 
            '<div style="display: flex; justify-content: center; align-items: center; height: 100%; color: #666;">Nenhum dado disponível</div>';
    }

    // ----------------------------------------------------
    // GRÁFICO 3: TOP 10 PROCEDIMENTOS NEGADOS (FULL WIDTH)
    // ----------------------------------------------------
    const ctx3 = recriarCanvas('grafico-top-negados').getContext('2d');
    
    if (stats.topNegados && stats.topNegados.length > 0) {
        const labelsTop = stats.topNegados.map(item => {
            const desc = item.descricao || `Código: ${item.codigo}`;
            return desc.length > 40 ? desc.substring(0, 40) + '...' : desc;
        });
        const dadosTop = stats.topNegados.map(item => parseFloat(item.totalNegado || 0));

        topNegadosChart = new Chart(ctx3, {
            type: 'bar',
            data: {
                labels: labelsTop,
                datasets: [{
                    label: 'Valor Negado',
                    data: dadosTop,
                    backgroundColor: 'rgba(0, 112, 255, 0.8)',
                    borderColor: 'rgba(0, 112, 255, 1)',
                    borderWidth: 1,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        beginAtZero: true,
                        title: { 
                            display: true, 
                            text: 'Valor Negado (R$)',
                            font: { size: 14 }
                        },
                        ticks: {
                            callback: function(value) {
                                return 'R$ ' + value.toLocaleString('pt-BR', {maximumFractionDigits: 0});
                            }
                        }
                    },
                    y: {
                        ticks: {
                            font: { size: 12 }
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    title: { 
                        display: true, 
                        text: 'Top 10 Procedimentos por Valor Total Negado',
                        font: { size: 18 }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => `Valor Negado: ${formatCurrency(context.parsed.x)}`
                        }
                    },
                    datalabels: {
                        anchor: 'end',
                        align: 'right',
                        color: '#585958',
                        font: { weight: 'bold', size: 12 },
                        formatter: (value) => formatCurrency(value)
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    } else {
        ctx3.canvas.parentNode.innerHTML = 
            '<div style="display: flex; justify-content: center; align-items: center; height: 100%; color: #666;">Nenhum dado disponível</div>';
    }
}

// --- Funções da Tabela e Paginação ---

function renderizarTabela(data = guiasData) { 
    const tbody = document.getElementById('guias-table-body');
    tbody.innerHTML = '';
    
    const totalPages = Math.ceil(data.length / itemsPerPage);
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const guiasPagina = data.slice(start, end);
    
    if (guiasPagina.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Nenhuma guia encontrada com os filtros/busca atuais.</td></tr>';
        return;
    }

    guiasPagina.forEach(guia => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${guia.numeroGuiaOperadora}</td>
            <td>${guia.prestadorNome}</td>
            <td>${guia.dataRegulacao || 'N/A'}</td>
            <td class="valor-negado">${formatCurrency(guia.totalNegado)}</td>
            <td><button onclick="mostrarDetalhes('${guia.id || guia._id || guia.numeroGuiaOperadora}')" class="btn-details btn-refresh" style="margin:0; padding: 5px 10px;">Ver Itens</button></td>
        `;
        tbody.appendChild(tr);
    });
}

function criarPaginacao(data = guiasData) { 
    const paginationControls = document.getElementById('pagination-controls');
    paginationControls.innerHTML = '';
    
    const totalPages = Math.ceil(data.length / itemsPerPage);
    
    if (totalPages <= 1) return;
    
    
    const setupPageButton = (btn, page) => {
        btn.addEventListener('click', () => {
            if (currentPage !== page) {
                currentPage = page;
                renderizarTabela(data); 
                criarPaginacao(data); 
            }
        });
    };
    
    
    const firstBtn = document.createElement('button');
    firstBtn.textContent = '1';
    setupPageButton(firstBtn, 1);
    if (currentPage === 1) firstBtn.classList.add('active');
    paginationControls.appendChild(firstBtn);
    
    const startPage = Math.max(2, currentPage - 1);
    const endPage = Math.min(totalPages - 1, currentPage + 1);
    
    if (startPage > 2) {
        const ellipsis = document.createElement('span');
        ellipsis.textContent = '...';
        ellipsis.style.margin = '0 5px';
        paginationControls.appendChild(ellipsis);
    }
    
    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.textContent = i;
        setupPageButton(pageBtn, i);
        if (currentPage === i) pageBtn.classList.add('active');
        paginationControls.appendChild(pageBtn);
    }
    
    if (endPage < totalPages - 1) {
        const ellipsis = document.createElement('span');
        ellipsis.textContent = '...';
        ellipsis.style.margin = '0 5px';
        paginationControls.appendChild(ellipsis);
    }
    
    if (totalPages > 1) {
        const lastBtn = document.createElement('button');
        lastBtn.textContent = totalPages;
        setupPageButton(lastBtn, totalPages);
        if (currentPage === totalPages) lastBtn.classList.add('active');
        paginationControls.appendChild(lastBtn);
    }
}

// --- Funções do Modal e Filtros ---

window.mostrarDetalhes = function(guiaId) {
    console.log("🔘 Botão clicado! ID:", guiaId, "Tipo:", typeof guiaId);

    const idNumerico = !isNaN(guiaId) ? Number(guiaId) : guiaId;
    
    const guia = guiasData.find(g => 
        g._id === idNumerico || 
        g._id === guiaId ||
        g.id === idNumerico || 
        g.id === guiaId ||
        (g.numeroGuiaOperadora && g.numeroGuiaOperadora.toString() === guiaId.toString())
    );
    
    if (!guia) {
        console.error("❌ Erro: Guia não encontrada. ID procurado:", guiaId);
        console.log("🔍 Primeira guia para referência:", guiasData[0] ? {
            _id: guiasData[0]._id,
            tipo_id: typeof guiasData[0]._id,
            numeroGuia: guiasData[0].numeroGuiaOperadora
        } : 'Nenhuma guia');
        alert('Guia não encontrada. Verifique o console para mais detalhes.');
        return;
    }

    console.log("✅ Guia encontrada:", guia);

    document.getElementById('modal-guia-titulo').textContent = `Itens Negados - Guia: ${guia.numeroGuiaOperadora || 'N/A'}`;
    
    const modalBody = document.getElementById('modal-itens-body');
    modalBody.innerHTML = '';

    if (guia.itensGuia && Array.isArray(guia.itensGuia) && guia.itensGuia.length > 0) {
        console.log(`📦 Encontrados ${guia.itensGuia.length} itens na guia`);
        
        guia.itensGuia.forEach((item, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'item-negado';
            
            const codigo = item.codigo || item.codigoProcedimento || 'N/A';
            const descricao = item.descricao || item.descricaoProcedimento || 'Descrição não disponível';
            const valorNegado = parseFloat(item.valorTotalNegado || item.valorNegado || 0);
            const quantSolicitada = item.quantSolicitada || 0;
            const quantAutorizada = item.quantAutorizada || 0;
            const quantNegada = item.quantNegada || (quantSolicitada - quantAutorizada);
            
            itemDiv.innerHTML = `
                <p><strong>Cód: ${codigo}</strong> <span style="color:var(--maida-vermelho); font-weight:bold;">${formatCurrency(valorNegado)}</span></p>
                <p style="color:#666; font-size:0.9em; margin-bottom:8px;">${descricao}</p>
                <div style="background:#eee; height:1px; margin:5px 0;"></div>
                <p><small>Solicitado: ${quantSolicitada}</small> <small>Negado: ${quantNegada}</small></p>
            `;
            modalBody.appendChild(itemDiv);
        });
    } else {
        console.log("❌ Nenhum item encontrado na guia:", guia);
        modalBody.innerHTML = `
            <div style="padding:20px; text-align:center; color:#666">
                <p>Nenhum item detalhado encontrado para esta guia.</p>
                <p style="font-size:0.8em; margin-top:10px;">Estrutura da guia:</p>
                <pre style="font-size:0.7em; text-align:left; background:#f5f5f5; padding:10px; border-radius:5px; max-height:200px; overflow:auto;">
${JSON.stringify(guia, null, 2)}
                </pre>
            </div>
        `;
    }

    const modal = document.getElementById('details-modal');
    modal.style.display = 'flex';
    
    setTimeout(() => {
        modal.classList.add('show');
    }, 10);
}
window.onclick = function(event) {
    const modal = document.getElementById('details-modal');
    if (event.target === modal) {
        window.fecharModal();
    }
}
function fecharModal() {
    const modal = document.getElementById('details-modal');
    modal.classList.remove('show');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300); // Espera a animação terminar
}
function filtrarGuias() {
    const termoBusca = document.getElementById('search-guia').value.toLowerCase().trim();
    
    const guiasFiltradas = guiasData.filter(guia => {
        const numeroGuia = guia.numeroGuiaOperadora ? String(guia.numeroGuiaOperadora).toLowerCase() : '';
        
        return numeroGuia.includes(termoBusca);
    });
    renderizarTabela(guiasFiltradas);
    criarPaginacao(guiasFiltradas);
    
    document.getElementById('guias-titulo').textContent = 
        `Guias com Negativa (${guiasFiltradas.length} Encontradas)`;
}

function exportarParaCSV() {
    if (guiasData.length === 0) {
        console.log('Nenhum dado para exportar.');
        return;
    }

    try {
        let csvContent = "Nº Guia;Prestador;Tipo de Guia;Data Regulação;Status;Total Negado;Item Código;Item Descrição;Qtd Solicitada;Qtd Autorizada;Qtd Negada;Valor Unitário;Valor Total Negado Item\n";

        guiasData.forEach(guia => {
            const baseRow = `\"${guia.numeroGuiaOperadora}\";\"${guia.prestadorNome}\";\"${guia.tipoGuia || 'N/A'}\";\"${guia.dataRegulacao}\";\"${guia.status}\";\"${guia.totalNegado}\"`;
            
            // Esta parte também depende de 'itensGuia'
            if (guia.itensGuia && guia.itensGuia.length > 0) {
                guia.itensGuia.forEach(item => {
                    csvContent += `${baseRow};\"${item.codigo}\";\"${item.descricao}\";\"${item.quantSolicitada || 0}\";\"${item.quantAutorizada || 0}\";\"${item.quantNegada || 0}\";\"${item.valorUnitario || 0}\";\"${item.valorTotalNegado || 0}\"\n`;
                });
            } else {
                // Exporta a guia mesmo sem itens (opcional)
                csvContent += `${baseRow};"N/A";"N/A";"0";"0";"0";"0";"0"\n`;
            }
        });
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", "guias_negadas.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
    } catch (error) {
        console.error('Erro ao exportar CSV:', error);
    }
}

// --- Inicialização e Event Listeners ---

// Define as datas padrão
const today = new Date();
const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
const formatDate = (d) => d.toISOString().split('T')[0];
document.getElementById('start-date-filter').value = formatDate(lastMonth);
document.getElementById('end-date-filter').value = formatDate(today);

// Carrega os dados iniciais
carregarDados();

// Adiciona os listeners aos botões e filtros
document.getElementById('start-date-filter').addEventListener('change', carregarDados);
document.getElementById('end-date-filter').addEventListener('change', carregarDados);
document.getElementById('export-btn').addEventListener('click', exportarParaCSV);
document.getElementById('refresh-btn').addEventListener('click', carregarDados);

// Listener do Modal
closeModalBtn.addEventListener('click', () => {
    detailsModal.style.display = 'none';
});

window.addEventListener('click', (event) => {
    const modal = document.getElementById('details-modal');
    if (event.target === modal) {
        fecharModal();
    }
});

// Listener da busca
document.getElementById('search-guia').addEventListener('keyup', () => {
    currentPage = 1; // Sempre volta para a primeira página ao filtrar
    filtrarGuias();
});
