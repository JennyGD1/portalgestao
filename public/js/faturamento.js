Chart.register(ChartDataLabels);

const API_BASE_URL = '/api/faturamento';
const loadingOverlay = document.getElementById('loading-overlay');

// 5 Minutos em milissegundos
const INTERVALO_ATUALIZACAO = 5 * 60 * 1000; 

const formatBRL = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);

document.addEventListener('DOMContentLoaded', () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    
    // Define a data inicial
    const inputProducao = document.getElementById('producao-filter');
    if (inputProducao) {
        inputProducao.value = `${yyyy}-${mm}`;
    }

    // Botão de filtrar manual (Mostra Loading)
    document.getElementById('refresh-btn').addEventListener('click', () => carregarDashboard(false));

    // Carregamento inicial (Mostra Loading)
    carregarDashboard(false);

    // --- LÓGICA DE TEMPO REAL ---
    // Inicia o contador para atualizar a cada 5 minutos
    setInterval(() => {
        console.log(`🔄 Atualizando dados automaticamente (${new Date().toLocaleTimeString()})...`);
        carregarDashboard(true); // true = Modo silencioso (sem loading)
    }, INTERVALO_ATUALIZACAO);
});

function showLoading() { if (loadingOverlay) loadingOverlay.style.display = 'flex'; }
function hideLoading() { if (loadingOverlay) loadingOverlay.style.display = 'none'; }

function getProducaoFormatada() {
    const inputVal = document.getElementById('producao-filter').value;
    if (!inputVal) return '';
    
    const [ano, mes] = inputVal.split('-');
    return `${mes}/${ano}`;
}

async function carregarDadosAnalise(producao) {
    try {
        const resp = await fetch(`${API_BASE_URL}/processos-analisados?producao=${producao}`, { credentials: 'include' });
        const json = await resp.json();
        
        if (json.success) {
            atualizarCardsAnalise(json.data);
        }
    } catch (err) {
        console.error("Erro ao carregar dados de análise:", err);
    }
}

function atualizarCardsAnalise(data) {
    if (!data) return;
    
    const {
        totalProcessos = 0,
        processosAnalisados = 0
    } = data;
    
    const elVal = document.getElementById('val-analisados');
    if (elVal) elVal.textContent = `${processosAnalisados}/${totalProcessos}`;
    
    const porcentagem = totalProcessos > 0 ? (processosAnalisados / totalProcessos) * 100 : 0;
    
    const progressBar = document.getElementById('analise-progress-bar');
    const progressText = document.getElementById('analise-progress-text');
    
    if (progressBar) {
        progressBar.style.width = `${porcentagem}%`;
    }
    if (progressText) {
        progressText.textContent = `${porcentagem.toFixed(1)}%`;
    }
}

/**
 * Função principal para carregar o Dashboard
 * @param {boolean} silent - Se true, não exibe a tela de loading (para updates automáticos)
 */
async function carregarDashboard(silent = false) {
    if (!silent) showLoading();
    
    const producao = getProducaoFormatada();
    // console.log("🔍 Buscando produção:", producao);

    try {
        const resp = await fetch(`${API_BASE_URL}/estatisticas?producao=${producao}`, { credentials: 'include' });
        const json = await resp.json();
        
        if (json.success) {
            atualizarKPIs(json.data.kpis[0]);
            atualizarStatusCards(json.data.statusStats, json.data.kpis[0]);
            renderizarGraficos(json.data);
            await carregarDadosAnalise(producao);
            
            if (silent) {
                console.log("✅ Dados atualizados com sucesso.");
            }
        }

    } catch (err) {
        console.error("Erro ao carregar dashboard:", err);
    } finally {
        if (!silent) hideLoading();
    }
}

function atualizarKPIs(data) {
    if (!data) data = { totalApresentado: 0, totalLiberado: 0, totalGlosa: 0 };
    
    const elApresentado = document.getElementById('val-apresentado');
    const elLiberado = document.getElementById('val-liberado');
    const elGlosa = document.getElementById('val-glosa');

    if (elApresentado) elApresentado.textContent = formatBRL(data.totalApresentado);
    if (elLiberado) elLiberado.textContent = formatBRL(data.totalLiberado);
    if (elGlosa) elGlosa.textContent = formatBRL(data.totalGlosa);
}

function atualizarStatusCards(statusData, kpisGerais) {
    
    // Total real de processos na competência
    const totalCompetencia = kpisGerais ? kpisGerais.count : 0;

    const mapStatusToCard = (statusDb) => {
        if (!statusDb) return null;
        
        // Remove acentos e converte para minúsculas para comparação segura
        const s = statusDb.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        if (s.includes('arquivado')) return 'card-arquivado';
        // 'concluido' adicionado para garantir compatibilidade com nova query do banco
        if (s.includes('tramitado') || s.includes('assinado') || s.includes('finalizado') || s.includes('concluido')) return 'card-tramitado';
        if (s.includes('em analise')) return 'card-em-analise';
        
        return 'card-para-analise';
    };

    const cards = {
        'card-para-analise': { qtd: 0, valor: 0 },
        'card-em-analise':   { qtd: 0, valor: 0 },
        'card-tramitado':    { qtd: 0, valor: 0 },
        'card-arquivado':    { qtd: 0, valor: 0 }
    };

    if (statusData) {
        statusData.forEach(item => {
            const cardId = mapStatusToCard(item._id);
            if (cardId && cards[cardId]) {
                cards[cardId].qtd += item.quantidade;
                cards[cardId].valor += item.totalValor;
            }
        });
    }

    Object.keys(cards).forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const dados = cards[id];
            
            // Cálculo da porcentagem em relação ao TOTAL DA COMPETÊNCIA
            let pct = 0;
            if (totalCompetencia > 0) {
                pct = ((dados.qtd / totalCompetencia) * 100).toFixed(1);
            }

            el.querySelector('.qtd').textContent = dados.qtd;
            el.querySelector('.val').textContent = formatBRL(dados.valor);
            el.querySelector('.pct').textContent = pct + '%';
        }
    });
}

let charts = {};

function recriarCanvas(id) {
    if (charts[id]) {
        charts[id].destroy();
    }
    
    const canvas = document.getElementById(id);
    if (!canvas) {
        // console.warn(`Canvas com id "${id}" não encontrado na DOM.`);
        return null;
    }
    
    return canvas.getContext('2d');
}

function renderizarGraficos(data) {
    // console.log("📊 Renderizando gráficos...");
    
    const cAzul = '#0070ff';
    const cRosa = '#ff0073';
    
    const barOptions = {
        barPercentage: 0.9,
        categoryPercentage: 0.9
    };

    const bordaPadrao = 4;

    // 1. TOP PRESTADORES (VOLUME)
    const ctxVol = recriarCanvas('chart-top-volume');
    if (ctxVol && data.topVolume && data.topVolume.length > 0) {
        charts['chart-top-volume'] = new Chart(ctxVol, {
            type: 'bar',
            data: {
                labels: data.topVolume.map(d => d._id || 'Sem nome'),
                datasets: [{
                    label: 'Valor Apresentado',
                    data: data.topVolume.map(d => d.totalApresentado || 0),
                    backgroundColor: cAzul,
                    borderRadius: bordaPadrao,
                    ...barOptions
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { display: false },
                    y: { 
                        grid: { display: false },
                        ticks: {
                            font: { size: 11 },
                            callback: function(val) {
                                const label = this.getLabelForValue(val);
                                return (label && label.length > 25) ? label.substring(0, 22) + '...' : label;
                            }
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        anchor: 'end', align: 'right',
                        formatter: (val) => formatBRL(val),
                        font: { size: 10, weight: 'bold' },
                        color: '#555'
                    }
                },
                layout: { padding: { right: 90 } }
            }
        });
    }

    // 2. TOP PRESTADORES (GLOSA)
    const ctxGlosa = recriarCanvas('chart-top-glosa');
    if (ctxGlosa && data.topGlosa && data.topGlosa.length > 0) {
        charts['chart-top-glosa'] = new Chart(ctxGlosa, {
            type: 'bar',
            data: {
                labels: data.topGlosa.map(d => d._id || 'Sem nome'),
                datasets: [{
                    label: 'Valor Glosado',
                    data: data.topGlosa.map(d => d.totalGlosa || 0),
                    backgroundColor: cRosa,
                    borderRadius: bordaPadrao,
                    ...barOptions
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { display: false },
                    y: { 
                        grid: { display: false },
                        ticks: {
                            font: { size: 11 },
                            callback: function(val) {
                                const label = this.getLabelForValue(val);
                                return (label && label.length > 25) ? label.substring(0, 22) + '...' : label;
                            }
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        anchor: 'end', align: 'right',
                        formatter: (val) => formatBRL(val),
                        color: cRosa,
                        font: { size: 10, weight: 'bold' }
                    }
                },
                layout: { padding: { right: 90 } }
            }
        });
    }

    // 3. TRATAMENTOS
    const ctxTrat = recriarCanvas('chart-tratamento');
    if (ctxTrat && data.tratamentos && data.tratamentos.length > 0) {
        const top5Tratamentos = [...data.tratamentos]
            .sort((a, b) => (b.totalValor || 0) - (a.totalValor || 0))
            .slice(0, 5);

        const totalTop5 = top5Tratamentos.reduce((acc, curr) => acc + (curr.totalValor || 0), 0);

        charts['chart-tratamento'] = new Chart(ctxTrat, {
            type: 'bar', 
            data: {
                labels: top5Tratamentos.map(d => d._id || 'N/A'),
                datasets: [{
                    label: 'Valor Total',
                    data: top5Tratamentos.map(d => d.totalValor || 0),
                    backgroundColor: cAzul,
                    borderRadius: bordaPadrao,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { 
                        display: false, 
                        grid: { display: false } 
                    },
                    x: { 
                        display: true, 
                        grid: { display: false },
                        ticks: {
                            font: { size: 10, weight: '600' },
                            color: '#555',
                            autoSkip: false, 
                            maxRotation: 0, 
                            callback: function(val, index) {
                                const label = this.getLabelForValue(val);
                                if (/\s/.test(label) && label.length > 10) {
                                    return label.split(' ');
                                }
                                return label;
                            }
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        anchor: 'end', 
                        align: 'top',
                        color: '#555',
                        font: { weight: 'bold', size: 11 },
                        formatter: (val) => ((val / totalTop5) * 100).toFixed(1) + '%'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return formatBRL(context.raw);
                            }
                        }
                    }
                },
                layout: { 
                    padding: { top: 25, bottom: 5 } 
                }
            }
        });
    }

    // 4. PRODUTIVIDADE
    const ctxProd = recriarCanvas('chart-produtividade');
    if (ctxProd && data.produtividade && data.produtividade.length > 0) {
        charts['chart-produtividade'] = new Chart(ctxProd, {
            type: 'bar',
            data: {
                labels: data.produtividade.map(d => d._id || 'N/A'),
                datasets: [
                    {
                        label: 'Valor Tramitado (R$)',
                        data: data.produtividade.map(d => d.totalTramitadoValor || 0),
                        backgroundColor: cAzul,
                        borderRadius: bordaPadrao,
                        yAxisID: 'y',
                        xAxisID: 'xValue',
                        order: 1,
                        ...barOptions
                    },
                    {
                        label: 'Qtd Processos',
                        data: data.produtividade.map(d => d.totalTramitadoQtd || 0),
                        backgroundColor: cRosa,
                        borderRadius: bordaPadrao,
                        yAxisID: 'y',
                        xAxisID: 'xQtd',
                        order: 2,
                        ...barOptions
                    }
                ]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { grid: { display: false } },
                    xValue: { display: false },
                    xQtd: { display: false }
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { usePointStyle: true, boxWidth: 8 }
                    },
                    datalabels: {
                        anchor: 'end', align: 'right',
                        font: { size: 10, weight: 'bold' },
                        formatter: (val, ctx) => {
                            if (ctx.datasetIndex === 0) return formatBRL(val);
                            return val;
                        },
                        color: (ctx) => ctx.dataset.backgroundColor
                    }
                },
                layout: { padding: { right: 100 } }
            }
        });
    }
}