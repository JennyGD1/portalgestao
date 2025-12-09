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
let iaComparativoChart = null; 
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
    
    // Busca os valores atuais dos filtros
    const search = document.getElementById('search-guia').value;
    const startDate = document.getElementById('start-date-filter').value;
    const endDate = document.getElementById('end-date-filter').value;

    // Cria os parâmetros URL com os filtros atuais
    const searchParams = new URLSearchParams();
    if (search) searchParams.append('search', search);
    if (startDate) searchParams.append('startDate', startDate);
    if (endDate) searchParams.append('endDate', endDate);
    
    const params = searchParams.toString();

    try {
        // 1. Busca estatísticas
        const statsResponse = await fetch(`${API_BASE_URL}/estatisticas?${params}`);
        const statsResult = await statsResponse.json();

        if (statsResult.success) {
            const stats = statsResult.data;
            
            document.getElementById('total-negado-geral').textContent = formatCurrency(stats.totalGeralNegado);
            document.getElementById('valor-medio-negado').textContent = formatCurrency(stats.valorMedio);
            document.getElementById('quantidade-guias').textContent = stats.quantidadeGuias;
            document.getElementById('maior-negativa-unica').textContent = formatCurrency(stats.totalGeralAutorizado);
            
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

        // 3. Busca dados de SLA
        try {
            const slaResponse = await fetch(`${API_BASE_URL}/sla-desempenho?${params}`);
            const slaResult = await slaResponse.json();
        
            if (slaResult.success) {
                console.log('✅ Dados de SLA e Reguladores carregados:', slaResult.data);
                
                document.getElementById('total-guias-sla').textContent = slaResult.data.totalGuiasSLA.toLocaleString('pt-BR');
                
                const slaPercentual = slaResult.data.slaGeral;
                document.getElementById('sla-geral-percentual').textContent = slaPercentual + '%';
                
                // Aplica cor condicional
                aplicarCorSLA(slaPercentual);
                
                criarGraficosSLA(slaResult.data); 
            } else {
                console.error('Erro nas estatísticas de SLA:', slaResult.error);
                document.getElementById('total-guias-sla').textContent = '0';
                document.getElementById('sla-geral-percentual').textContent = '0,0%';
                aplicarCorSLA(0); // Aplica cor rosa para erro
            }
        } catch (slaError) {
             console.error('Erro ao buscar dados de SLA:', slaError);
             aplicarCorSLA(0);
        }

    } catch (error) {
        console.error('Erro ao buscar dados:', error);
        document.getElementById('guias-titulo').textContent = 'Erro ao carregar dados';
    } finally {
        hideLoading();
    }
}
// --------------------------------------------------------------------------------
// FUNÇÃO: MONITORAMENTO EM TEMPO REAL 
// --------------------------------------------------------------------------------
async function carregarSLAEmTempoReal() {
    const container = document.getElementById('realtime-container');
    const timeLabel = document.getElementById('last-update-time');
    
    // Atualiza hora
    const agora = new Date();
    timeLabel.textContent = `Atualizado em: ${agora.toLocaleTimeString()}`;

    try {
        const response = await fetch(`${API_BASE_URL}/sla-tempo-real`);
        const result = await response.json();

        if (result.success) {
            container.innerHTML = '';
            
            // Criar container para a primeira linha (Eletivas)
            const linhaEletivas = document.createElement('div');
            linhaEletivas.className = 'rt-linha';
            linhaEletivas.style.display = 'flex';
            linhaEletivas.style.justifyContent = 'space-between';
            linhaEletivas.style.marginBottom = '20px';
            linhaEletivas.style.flexWrap = 'wrap';
            
            // Criar container para a segunda linha (Urgências)
            const linhaUrgencias = document.createElement('div');
            linhaUrgencias.className = 'rt-linha';
            linhaUrgencias.style.display = 'flex';
            linhaUrgencias.style.justifyContent = 'space-between';
            linhaUrgencias.style.flexWrap = 'wrap';
            
            // Função para criar card
            const criarCard = (fila) => {
                const card = document.createElement('div');
                card.className = `rt-card status-${fila.status}`;
                card.style.flex = '1';
                card.style.minWidth = '23%';
                card.style.margin = '0 1%';
                
                // Lógica de Alerta Separada
                const temVencidas = fila.totalVencidas > 0;
                const temProximas = fila.totalProximas > 0;
                
                let alertHtml = '<div style="height:34px"></div>'; // Espaço vazio padrão

                if (temVencidas || temProximas) {
                    
                    // 1. Define o Texto do Badge (Botãozinho colorido)
                    let badgeLabel = '';
                    let badgeClass = ''; // Para estilizar cor se quiser

                    if (temVencidas && temProximas) {
                        badgeLabel = `🚨 ${fila.totalVencidas} Vencidas | ⚠️ ${fila.totalProximas} Próx.`;
                    } else if (temVencidas) {
                        badgeLabel = `🚨 ${fila.totalVencidas} Guias Vencidas`;
                    } else {
                        badgeLabel = `⚠️ ${fila.totalProximas} Próximas do Venc.`;
                    }

                    // 2. Monta o Conteúdo do Tooltip (Separado)
                    let tooltipContentHtml = '';

                    // Seção de Vencidas (Vermelho)
                    if (temVencidas) {
                        const listaV = fila.listaVencidas.map(num => `<div class="rt-tooltip-item" style="color:#c62828;">${num}</div>`).join('');
                        tooltipContentHtml += `
                            <div style="margin-bottom:10px;">
                                <strong style="color:#c62828; border-bottom:1px solid #ffd7d7;">JÁ VENCIDAS (${fila.totalVencidas})</strong>
                                <div class="rt-tooltip-list">${listaV}</div>
                            </div>
                        `;
                    }

                    // Seção de Próximas (Laranja/Amarelo Escuro)
                    if (temProximas) {
                        const listaP = fila.listaProximas.map(num => `<div class="rt-tooltip-item" style="color:#d35400;">${num}</div>`).join('');
                        tooltipContentHtml += `
                            <div>
                                <strong style="color:#d35400; border-bottom:1px solid #fdebd0;">VENCEM EM BREVE (${fila.totalProximas})</strong>
                                <div class="rt-tooltip-list">${listaP}</div>
                            </div>
                        `;
                    }

                    alertHtml = `
                        <div class="rt-alert-wrapper">
                            <div class="rt-alert-badge" style="${temVencidas ? 'background:#ffebee; color:#c62828;' : 'background:#fff3e0; color:#e65100;'}">
                                ${badgeLabel}
                            </div>
                            
                            <div class="rt-tooltip-content" style="width: 250px;">
                                ${tooltipContentHtml}
                                <div style="font-size:0.7em; color:#999; margin-top:5px; text-align:center;">
                                    Copie os números acima
                                </div>
                            </div>
                        </div>
                    `;
                }

                card.innerHTML = `
                    <div class="rt-title">${fila.label}</div>
                    <div class="rt-stats">
                        <div class="rt-sla">
                            ${fila.percentualSLA}%
                            <br><span>DENTRO DO PRAZO</span>
                        </div>
                        <div class="rt-volume">
                            <strong>${fila.total}</strong>
                            GUIAS EM ANÁLISE
                        </div>
                    </div>
                    ${alertHtml}
                `;
                
                return card;
            };
            
            // Adicionar cards eletivos na primeira linha
            result.data.eletivas.forEach(fila => {
                linhaEletivas.appendChild(criarCard(fila));
            });
            
            // Adicionar cards urgências na segunda linha
            result.data.urgencias.forEach(fila => {
                linhaUrgencias.appendChild(criarCard(fila));
            });
            
            // Adicionar as linhas ao container principal
            container.appendChild(linhaEletivas);
            container.appendChild(linhaUrgencias);
        }
    } catch (error) {
        console.error('Erro no monitoramento realtime:', error);
        container.innerHTML = '<div style="color:red; padding:10px;">Erro ao atualizar filas. Tentando novamente em breve...</div>';
    }
}

carregarSLAEmTempoReal();

setInterval(carregarSLAEmTempoReal, 30 * 60 * 1000);

function aplicarCorSLA(slaPercentual) {
    const slaCard = document.getElementById('sla-geral-percentual').closest('.metrica-card');
    if (!slaCard) return;
    
    slaCard.classList.remove('bg-azul', 'bg-rosa', 'bg-amarelo');
    
    if (slaPercentual >= 98) {
        slaCard.classList.add('bg-azul'); // Acima de 98% - Azul
        console.log('🎯 SLA: Excelente (Azul) - ' + slaPercentual + '%');
    } else if (slaPercentual >= 90) {
        slaCard.classList.add('bg-amarelo'); // Entre 90-97% - Amarelo
        console.log('⚠️ SLA: Atenção (Amarelo) - ' + slaPercentual + '%');
    } else {
        slaCard.classList.add('bg-rosa'); // Abaixo de 90% - Rosa
        console.log('🚨 SLA: Crítico (Rosa) - ' + slaPercentual + '%');
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
    if (id === 'grafico-ia-comparativo' && iaComparativoChart) iaComparativoChart.destroy(); 

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
    // Pega apenas os últimos 12 pontos
    const dadosTendenciaFiltrados = dadosTendencia.slice(-12);

    // Muda os labels para "1 semana", "2 semana", etc.
    const labelsTendencia = dadosTendenciaFiltrados.map((item, index) => {
        return `${index + 1}ª semana`;
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
        const labelsAbreviados = labelsTipo.map(tipo => {
            const tipoLower = tipo.toLowerCase();
            if (tipoLower.includes('prorrogacao') || tipoLower.includes('prorrogação')) return 'Prorrogação';
            if (tipoLower.includes('solicitacao') && tipoLower.includes('internacao')) return 'Internação';
            if (tipoLower.includes('solicitacao') && tipoLower.includes('opme')) return 'OPME';
            if (tipoLower.includes('honorario') || tipoLower.includes('honorário')) return 'Honorários';
            return tipo;
        });
        
        slaTipoChart = new Chart(ctxSla1, {
            type: 'bar',
            data: {
                labels: labelsAbreviados,
                datasets: [{
                    label: 'SLA (%)',
                    data: dadosTipo.map(item => parseFloat(item.percentualSLA)),
                    backgroundColor: COR_AZUL,
                    borderRadius: 4,
                }]
            },
            options: {
                indexAxis: 'x', // Barras VERTICAIS
                responsive: true, 
                maintainAspectRatio: false,
                scales: { 
                    x: { 
                        grid: {
                            display: false // Remove linhas de grid verticais
                        }
                    },
                    y: { 
                        beginAtZero: true, 
                        max: 100,
                        grid: {
                            display: false // Remove linhas de grid horizontais
                        },
                        display: false // Remove completamente o eixo Y
                    } 
                },
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        anchor: 'center', // <-- CENTRALIZADO na coluna
                        align: 'center',  // <-- CENTRALIZADO na coluna  
                        color: '#ffffff', // <-- FONTE BRANCA
                        font: { weight: 'bold', size: 12 },
                        formatter: (value) => value.toFixed(1) + '%'
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    }

    // GRÁFICO 2: Distribuição de Volume (Doughnut)
    const ctxSla2 = recriarCanvasSLA('grafico-sla-volume', 'chart-wrapper-sla-2').getContext('2d');
    if (dadosTipo.length > 0) {
        
        const labelsComPercentual = dadosTipo.map(item => {
            const percentual = ((item.total / totalGeral) * 100).toFixed(0);
            return `${item.tipo} (${percentual}%)`; 
        });

        slaVolumeChart = new Chart(ctxSla2, {
            type: 'doughnut',
            data: {
                labels: labelsComPercentual,
                datasets: [{
                    data: dadosTipo.map(item => item.total),
                    backgroundColor: [COR_AZUL, COR_ROSA, COR_AMARELO, COR_CINZA, '#9933ff', '#33cccc'],
                    borderColor: '#ffffff', borderWidth: 2
                }]
            },
            options: {
                responsive: true, 
                maintainAspectRatio: false,
                plugins: {
                    legend: { 
                        position: 'right',  // MUDOU DE 'bottom' PARA 'right'
                        labels: { 
                            font: { size: 11 },
                            padding: 15,
                            boxWidth: 12,   // Tamanho do quadradinho da cor
                            usePointStyle: true // Opcional: usa círculo em vez de quadrado
                        } 
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => ` ${context.label}: ${context.parsed.toLocaleString()} guias`
                        }
                    },
                    datalabels: {
                        color: '#ffffff',
                        font: { weight: 'bold', size: 11 },
                        formatter: (value, context) => {
                            const percent = ((value / totalGeral) * 100).toFixed(0);
                            return percent + '%';
                        }
                    }
                },
                // Ajusta o layout para dar mais espaço à direita
                layout: {
                    padding: {
                        left: 10,
                        right: 10,
                        top: 10,
                        bottom: 10
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
        const labelsAbreviados = labelsTipo.map(tipo => {
            const tipoLower = tipo.toLowerCase();
            if (tipoLower.includes('prorrogacao') || tipoLower.includes('prorrogação')) return 'Prorrogação';
            if (tipoLower.includes('solicitacao') && tipoLower.includes('internacao')) return 'Internação';
            if (tipoLower.includes('solicitacao') && tipoLower.includes('opme')) return 'OPME';
            if (tipoLower.includes('honorario') || tipoLower.includes('honorário')) return 'Honorários';
            return tipo;
        });
        
        slaComparativoChart = new Chart(ctxSla3, {
            type: 'bar',
            data: {
                labels: labelsAbreviados,
                datasets: [
                    { label: 'Dentro SLA', data: dadosTipo.map(item => item.dentroSLA), backgroundColor: COR_AZUL },
                    { label: 'Fora SLA', data: dadosTipo.map(item => item.foraSLA), backgroundColor: COR_ROSA }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                // --- SEÇÃO CORRIGIDA ---
                scales: { 
                    x: { stacked: true, grid: { display: false } }, // Remove linhas verticais
                    y: { stacked: true, display: false } // Remove eixo Y (legenda/linhas)
                }, 
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
                scales: { 
                    y: { 
                        beginAtZero: false, 
                        min: 50, 
                        max: 105, 
                        title: { display: true, text: 'SLA (%)' } 
                    } 
                },

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
                indexAxis: 'y', 
                responsive: true, maintainAspectRatio: false,
                scales: { 
                    x: { 
                        display: false, 
                        beginAtZero: true, 
                        max: 100 
                    } 
                },
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
                    { 
                        label: 'Total de Guias', 
                        data: topReguladores.map(item => item.total), 
                        backgroundColor: COR_AZUL,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                indexAxis: 'y', 
                responsive: true, 
                maintainAspectRatio: false,
                scales: { 
                    x: { 
                        display: false, 
                        grid: { display: false }
                    }, 
                    y: { 
                        grid: { display: false }
                    } 
                },
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        display: true,
                        color: (context) => {
                            const value = context.dataset.data[context.dataIndex];
                            return value < 100 ? '#000000' : '#ffffff';
                        },
                        anchor: 'end',
                        align: (context) => {
                            const value = context.dataset.data[context.dataIndex];
                            return value < 100 ? 'end' : 'start';
                        },
                        offset: 4,
                        font: { weight: 'bold', size: 11 },
                        formatter: (value) => value.toLocaleString()
                    }
                },
                layout: {
                    padding: {
                        right: 40 
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    }
    if (data.comparativoIA) {
        
        document.getElementById('share-ymir-val').textContent = data.comparativoIA.share.ymir + '%';
        document.getElementById('share-gabriel-val').textContent = data.comparativoIA.share.gabriel + '%';
        document.getElementById('share-outros-val').textContent = data.comparativoIA.share.outros + '%';

        const timeline = data.comparativoIA.timeline || [];
        const ctxIA = recriarCanvasSLA('grafico-ia-comparativo', 'chart-wrapper-ia-compare').getContext('2d');
        
        const labelsTimeline = timeline.map(t => {
            const d = new Date(t.data);
            return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
        });

        iaComparativoChart = new Chart(ctxIA, {
            type: 'line',
            data: {
                labels: labelsTimeline,
                datasets: [
                    {
                        label: 'Ymir',
                        data: timeline.map(t => t.ymir),
                        borderColor: '#ff0073',
                        backgroundColor: '#ff0073',
                        tension: 0.3,
                        borderWidth: 3,
                        pointRadius: 4
                    },
                    {
                        label: 'Robô',
                        data: timeline.map(t => t.gabriel),
                        borderColor: '#2980b9', 
                        backgroundColor: '#2980b9',
                        tension: 0.3,
                        borderWidth: 3,
                        pointRadius: 4
                    },
                    {
                        label: 'Demais Reguladores',
                        data: timeline.map(t => t.outros),
                        borderColor: '#bdc3c7',
                        backgroundColor: '#bdc3c7',
                        borderDash: [5, 5], 
                        tension: 0.3,
                        borderWidth: 2,
                        pointRadius: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { usePointStyle: true, font: { weight: 'bold' } }
                    },
                    datalabels: { display: false }, 
                    tooltip: {
                        callbacks: {
                            title: (items) => `Semana de: ${items[0].label}`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Volume de Guias' }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
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
    if (topPrestadoresChart) topPrestadoresChart.destroy();
    if (tiposGuiaChart) tiposGuiaChart.destroy();
    if (topNegadosChart) topNegadosChart.destroy();

    // GRÁFICO 1: TOP 10 PRESTADORES MAIS GLOSADOS
    const ctx1 = recriarCanvas('grafico-top-prestadores').getContext('2d');

    if (stats.topPrestadores && stats.topPrestadores.length > 0) {
        const labelsPrestadores = stats.topPrestadores.map(item => {
            const nome = item.prestador || 'Prestador Não Informado';
            return nome.length > 30 ? nome.substring(0, 30) + '...' : nome;
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
                        display: false,
                    },
                    y: {
                        ticks: {
                            font: { size: 12 },
                            padding: 15
                        },
                        grid: {
                            display: false
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
                            label: (context) => {
                                const prestadorCompleto = stats.topPrestadores[context.dataIndex].prestador || 'Prestador Não Informado';
                                return `${prestadorCompleto}: ${formatCurrency(context.parsed.x)}`;
                            }
                        }
                    },
                    datalabels: {
                        anchor: 'end',
                        align: 'right',
                        color: '#585958',
                        font: { weight: 'bold', size: 12 },
                        formatter: (value) => formatCurrency(value),
                        padding: {
                            right: 25 
                        },
                        clip: false 
                    }
                },
                layout: {
                    padding: {
                        right: 60 
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    } else {
        ctx1.canvas.parentNode.innerHTML = 
            '<div style="display: flex; justify-content: center; align-items: center; height: 100%; color: #666;">Nenhum dado disponível</div>';
    }

    // GRÁFICO 2: DISTRIBUIÇÃO POR TIPO DE GUIA (COM SETAS DISTRIBUÍDAS)
    // ----------------------------------------------------
    const ctx2 = recriarCanvas('grafico-tipos-guia').getContext('2d');

    if (stats.topTiposGuia && stats.topTiposGuia.length > 0) {
        const labelsTipos = stats.topTiposGuia.map(item => {
            return item.tipoGuia || 'Tipo Não Informado';
        });
        const dadosTipos = stats.topTiposGuia.map(item => parseFloat(item.totalNegado || 0));
        const total = dadosTipos.reduce((sum, value) => sum + value, 0);

        const cores = [
            '#0070ff', '#ff0073', '#ffcc00', '#34c759', '#5856d6',
            '#ff9500', '#ff2d55', '#5ac8fa', '#4cd964', '#ff3b30'
        ];

        tiposGuiaChart = new Chart(ctx2, {
            type: 'doughnut',
            data: {
                labels: labelsTipos,
                datasets: [{
                    data: dadosTipos,
                    backgroundColor: cores,
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const label = context.label || '';
                                const value = context.parsed;
                                const percent = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                                return `${label}: ${formatCurrency(value)} (${percent}%)`;
                            }
                        }
                    },
                    datalabels: {
                        display: false
                    }
                },
                layout: {
                    padding: {
                        top: 100,
                        right: 120,
                        bottom: 100,
                        left: 120
                    }
                }
            },
            plugins: [ChartDataLabels]
        });

        function desenharSetasLegendasDistribuidas(chart) {
            const ctx = chart.ctx;
            const meta = chart.getDatasetMeta(0);
            const total = chart.data.datasets[0].data.reduce((a, b) => a + b, 0);

            ctx.save();
            ctx.font = '14px Arial';
            ctx.textBaseline = 'middle';

            const centerX = chart.chartArea.left + (chart.chartArea.width / 2);
            const centerY = chart.chartArea.top + (chart.chartArea.height / 2);
            const radius = Math.min(chart.chartArea.width, chart.chartArea.height) / 2;

            const quadrantesPorCor = {
                '#ff0073': 'esquerda-inferior',    // Rosa
                '#ffcc00': 'esquerda-superior',    // Amarelo  
                '#34c759': 'direita-superior',     // Verde
                '#0070ff': 'direita-inferior'      // Azul
            };

            const posicoesQuadrantes = {
                'esquerda-superior': { 
                    x: centerX - 250,  
                    y: centerY - 160,
                    textAlign: 'right'
                },
                'esquerda-inferior': { 
                    x: centerX - 250,  
                    y: centerY + 160,
                    textAlign: 'right'
                },
                'direita-superior': { 
                    x: centerX + 250,  
                    y: centerY - 160,
                    textAlign: 'left'
                },
                'direita-inferior': { 
                    x: centerX + 250,  
                    y: centerY + 160,
                    textAlign: 'left'
                }
            };

            meta.data.forEach((element, index) => {
                const model = element;
                const value = chart.data.datasets[0].data[index];
                const label = chart.data.labels[index];
                const percent = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                const color = chart.data.datasets[0].backgroundColor[index];

                const angle = model.startAngle + (model.endAngle - model.startAngle) / 2;

                const pointX = centerX + Math.cos(angle) * (radius + 5);
                const pointY = centerY + Math.sin(angle) * (radius + 5);

                const quadrante = quadrantesPorCor[color] || 'direita-superior';
                const posicao = posicoesQuadrantes[quadrante];
                
                let textX = posicao.x;
                let textY = posicao.y;

                
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.moveTo(pointX, pointY);

                if (quadrante.includes('esquerda')) {
                    ctx.lineTo(textX + 25, pointY);  
                    ctx.lineTo(textX + 25, textY);
                } else {
                    ctx.lineTo(textX - 25, pointY);  
                    ctx.lineTo(textX - 25, textY);
                }
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(textX, textY, 4, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();

                ctx.textAlign = posicao.textAlign;
                const textPadding = posicao.textAlign === 'left' ? 10 : -10;

                ctx.fillStyle = '#333';
                
                ctx.font = 'bold 14px Arial';  
                ctx.fillText(`${label}`, textX + textPadding, textY - 7);
                
                ctx.font = '14px Arial';  
                ctx.fillText(`${percent}%`, textX + textPadding, textY + 7);
            });

            ctx.restore();
        }

        Chart.register({
            id: 'setasLegendasDistribuidas',
            afterDraw: function(chart) {
                if (chart.config.type === 'doughnut' && chart.canvas.id === 'grafico-tipos-guia') {
                    desenharSetasLegendasDistribuidas(chart);
                }
            }
        });

    } else {
        ctx2.canvas.parentNode.innerHTML = 
            '<div style="display: flex; justify-content: center; align-items: center; height: 100%; color: #666;">Nenhum dado disponível</div>';
    }

    // GRÁFICO 3: TOP 10 PROCEDIMENTOS NEGADOS (FULL WIDTH)
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
                        display: false,
                    },
                    y: {
                        ticks: {
                            font: { size: 12 },
                            padding: 15
                        },
                        grid: {
                            display: false
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
                            label: (context) => {
                                const descricaoCompleta = stats.topNegados[context.dataIndex].descricao || `Código: ${stats.topNegados[context.dataIndex].codigo}`;
                                return `${descricaoCompleta}: ${formatCurrency(context.parsed.x)}`;
                            }
                        }
                    },
                    datalabels: {
                        anchor: 'end',
                        align: 'right',
                        color: '#585958',
                        font: { weight: 'bold', size: 12 },
                        formatter: (value) => formatCurrency(value),
                        padding: {
                            right: 10
                        },
                        clip: false 
                    }
                },
                layout: {
                    padding: {
                        right: 100 
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
    }, 300); 
}
function filtrarGuias() {
    const termoBusca = document.getElementById('search-guia').value.toLowerCase().trim();
    
    const guiasFiltradas = guiasData.filter(guia => {
        const numeroGuia = guia.numeroGuiaOperadora ? String(guia.numeroGuiaOperadora).toLowerCase() : '';
        const prestador = guia.prestadorNome ? String(guia.prestadorNome).toLowerCase() : '';
        
        return numeroGuia.includes(termoBusca) || prestador.includes(termoBusca);
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
            
            if (guia.itensGuia && guia.itensGuia.length > 0) {
                guia.itensGuia.forEach(item => {
                    csvContent += `${baseRow};\"${item.codigo}\";\"${item.descricao}\";\"${item.quantSolicitada || 0}\";\"${item.quantAutorizada || 0}\";\"${item.quantNegada || 0}\";\"${item.valorUnitario || 0}\";\"${item.valorTotalNegado || 0}\"\n`;
                });
            } else {
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

const today = new Date();
const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1); 

const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
const formatDate = (d) => d.toISOString().split('T')[0];

document.getElementById('start-date-filter').value = formatDate(currentMonthStart);
document.getElementById('end-date-filter').value = formatDate(today);

carregarDados();

document.getElementById('export-btn').addEventListener('click', exportarParaCSV);
document.getElementById('refresh-btn').addEventListener('click', carregarDados);

closeModalBtn.addEventListener('click', () => {
    detailsModal.style.display = 'none';
});

window.addEventListener('click', (event) => {
    const modal = document.getElementById('details-modal');
    if (event.target === modal) {
        fecharModal();
    }
});

document.getElementById('search-guia').addEventListener('keyup', () => {
    currentPage = 1; 
    filtrarGuias();
});
