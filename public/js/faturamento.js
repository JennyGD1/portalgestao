Chart.register(ChartDataLabels);

const API_BASE_URL = '/api/faturamento';
const loadingOverlay = document.getElementById('loading-overlay');

const formatBRL = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);

document.addEventListener('DOMContentLoaded', () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    
    document.getElementById('producao-filter').value = `${yyyy}-${mm}`;

    document.getElementById('refresh-btn').addEventListener('click', carregarDashboard);

    carregarDashboard();
});

function showLoading() { loadingOverlay.style.display = 'flex'; }
function hideLoading() { loadingOverlay.style.display = 'none'; }

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
    
    document.getElementById('val-analisados').textContent = 
        `${processosAnalisados}/${totalProcessos}`;
    
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
async function carregarDashboard() {
    showLoading();
    
    const producao = getProducaoFormatada();
    console.log("🔍 Buscando produção:", producao);

    try {
        const resp = await fetch(`${API_BASE_URL}/estatisticas?producao=${producao}`, { credentials: 'include' });
        const json = await resp.json();
        
        if (json.success) {
            atualizarKPIs(json.data.kpis[0]);
            atualizarStatusCards(json.data.statusStats, json.data.kpis[0]);
            renderizarGraficos(json.data);
            await carregarDadosAnalise(producao);
        }

    } catch (err) {
        console.error("Erro ao carregar dashboard:", err);
    } finally {
        hideLoading();
    }
}

function atualizarKPIs(data) {
    if (!data) data = { totalApresentado: 0, totalLiberado: 0, totalGlosa: 0 };
    
    document.getElementById('val-apresentado').textContent = formatBRL(data.totalApresentado);
    document.getElementById('val-liberado').textContent = formatBRL(data.totalLiberado);
    document.getElementById('val-glosa').textContent = formatBRL(data.totalGlosa);
}

function atualizarStatusCards(statusData, kpisGerais) {
    
    const mapStatusToCard = (statusDb) => {
        if (!statusDb) return null;
        
        const s = statusDb.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        if (s.includes('arquivado')) return 'card-arquivado';
        if (s.includes('tramitado') || s.includes('assinado') || s.includes('finalizado')) return 'card-tramitado';
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

    const totalVisual = Object.values(cards).reduce((acc, curr) => acc + curr.qtd, 0);

    Object.keys(cards).forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const dados = cards[id];
            const pct = totalVisual > 0 ? ((dados.qtd / totalVisual) * 100).toFixed(1) : 0;

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
        console.error(`Canvas com id "${id}" não encontrado`);
        return null;
    }
    return canvas.getContext('2d');
}

function renderizarGraficos(data) {
    console.log("📊 Renderizando gráficos com dados:", data);
    
    const cAzul = '#0070ff';
    const cRosa = '#ff0073';
    
    const barOptions = {
        barPercentage: 0.9,
        categoryPercentage: 0.9
    };

    const bordaPadrao = 4;

    // --------------------------------------------------------
    // 1. TOP PRESTADORES (VOLUME)
    // --------------------------------------------------------
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
                    x: { 
                        grid: { display: false }, 
                        ticks: { display: false }
                    },
                    y: { 
                        grid: { display: false },
                        ticks: {
                            font: { size: 11 },
                            callback: function(value) {
                                const label = this.getLabelForValue(value);
                                if (label && label.length > 30) {
                                    return label.substring(0, 27) + '...';
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
                        align: 'right',
                        formatter: (val) => formatBRL(val),
                        font: { size: 10, weight: 'bold' },
                        color: '#555'
                    }
                },
                layout: { 
                    padding: { 
                        left: 5,
                        right: 90,
                        top: 10,
                        bottom: 10
                    } 
                }
            }
        });
    }

    // --------------------------------------------------------
    // 2. TOP PRESTADORES (GLOSA)
    // --------------------------------------------------------
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
                    x: { 
                        grid: { display: false }, 
                        ticks: { display: false }
                    },
                    y: { 
                        grid: { display: false },
                        ticks: {
                            font: { size: 11 },
                            callback: function(value) {
                                const label = this.getLabelForValue(value);
                                if (label && label.length > 30) {
                                    return label.substring(0, 27) + '...';
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
                        align: 'right',
                        formatter: (val) => formatBRL(val),
                        color: cRosa,
                        font: { size: 10, weight: 'bold' }
                    }
                },
                layout: { 
                    padding: { 
                        left: 5,
                        right: 90,
                        top: 10,
                        bottom: 10
                    } 
                }
            }
        });
    }

    // --------------------------------------------------------
    // 3. TRATAMENTOS
    // --------------------------------------------------------
    const ctxTrat = recriarCanvas('chart-tratamento');
    if (ctxTrat && data.tratamentos && data.tratamentos.length > 0) {
        const totalTrat = data.tratamentos.reduce((acc, curr) => acc + (curr.totalValor || 0), 0);
        const tratamentosFiltrados = data.tratamentos.filter(t => {
            const pct = ((t.totalValor || 0) / totalTrat) * 100;
            return pct >= 5;
        });

        charts['chart-tratamento'] = new Chart(ctxTrat, {
            type: 'bar',
            data: {
                labels: tratamentosFiltrados.map(d => d._id || 'Sem tipo'),
                datasets: [{
                    label: 'Valor Total',
                    data: tratamentosFiltrados.map(d => d.totalValor || 0),
                    backgroundColor: cAzul,
                    borderRadius: bordaPadrao,
                    ...barOptions
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { grid: { display: false } },
                    y: { grid: { display: false }, ticks: { display: false } }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${formatBRL(ctx.raw)}`
                        }
                    },
                    datalabels: {
                        anchor: 'end',
                        align: 'top',
                        color: '#555',
                        font: { weight: 'bold', size: 11 },
                        formatter: (val) => ((val / totalTrat) * 100).toFixed(1) + '%'
                    }
                },
                layout: { padding: { top: 30 } }
            }
        });
    }

    // --------------------------------------------------------
    // 4. PRODUTIVIDADE
    // --------------------------------------------------------
    const ctxProd = recriarCanvas('chart-produtividade');
    if (ctxProd && data.produtividade && data.produtividade.length > 0) {
        charts['chart-produtividade'] = new Chart(ctxProd, {
            type: 'bar',
            data: {
                labels: data.produtividade.map(d => d._id || 'Sem responsável'),
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
                    xValue: { 
                        type: 'linear', 
                        position: 'top', 
                        display: false, 
                        grid: { display: false } 
                    },
                    xQtd: { 
                        type: 'linear', 
                        position: 'bottom', 
                        display: false, 
                        grid: { display: false } 
                    }
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { usePointStyle: true, boxWidth: 8 }
                    },
                    datalabels: {
                        anchor: 'end',
                        align: 'right',
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
