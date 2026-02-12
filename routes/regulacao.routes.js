const express = require('express');
const router = express.Router();


function getInicioSemana(dateString) {
    const data = new Date(dateString + 'T12:00:00Z'); 
    const diaDaSemana = data.getUTCDay(); 
    const diff = data.getUTCDate() - diaDaSemana;
    const inicioSemana = new Date(data.setUTCDate(diff));
    return inicioSemana.toISOString().split('T')[0];
}
router.get('/sla-tempo-real', async (req, res) => {
    try {
        console.log('🔄 Iniciando monitoramento de SLA em Tempo Real...');

        const GAS_TOKEN_URL = process.env.GAS_TOKEN_URL; 
        let authToken = '';

        try {
            const urlToken = GAS_TOKEN_URL;
            const tokenResponse = await fetch(urlToken);
            if (!tokenResponse.ok) throw new Error('Falha ao obter token do GAS');
            const tokenData = await tokenResponse.json();
            authToken = tokenData.token || tokenData.accessToken || tokenData; 
        } catch (tokenError) {
            console.error('❌ Erro fatal: Falha na autenticação (Token).', tokenError);
            return res.status(500).json({ success: false, error: 'Falha na autenticação externa' });
        }
        const baseURL = 'https://regulacao-api.issec.maida.health/v3/historico-cliente?ordenarPor=DATA_SOLICITACAO&listaDeStatus=EM_ANALISE,EM_REANALISE,DOCUMENTACAO_EM_ANALISE';
    
        const filasEletivas = [
            { 
                id: 'INTERNACAO_ELETIVA', 
                label: 'Internação Eletiva', 
                url: `${baseURL}&tipoDeGuia=SOLICITACAO_INTERNACAO`,
                tipo: 'eletiva',
                prazoHoras: 21 * 24,
                limiteAlertaHoras: 24
            },
            { 
                id: 'SADT_ELETIVA', 
                label: 'SP/SADT Eletiva', 
                url: `${baseURL}&tipoDeGuia=SP_SADT`,
                tipo: 'eletiva',
                prazoHoras: 10 * 24,
                limiteAlertaHoras: 24
            },
            { 
                id: 'PRORROGACAO', 
                label: 'Prorrogação (Geral)', 
                url: `${baseURL}&tipoDeGuia=PRORROGACAO_DE_INTERNACAO`,
                tipo: 'eletiva', 
                prazoHoras: 24,
                limiteAlertaHoras: 2
            },
            { 
                id: 'OPME_ELETIVA', 
                label: 'OPME Eletiva', 
                url: `${baseURL}&tipoDeGuia=SOLICITACAO_DE_OPME`,
                tipo: 'eletiva',
                prazoHoras: 21 * 24, 
                limiteAlertaHoras: 24
            }
        ];

        const filasUrgencias = [
            { 
                id: 'INTERNACAO_URGENCIA', 
                label: 'Internação Urgência', 
                url: `${baseURL}&tipoDeGuia=SOLICITACAO_INTERNACAO`,
                tipo: 'urgencia', 
                prazoHoras: 6,
                limiteAlertaHoras: 1
            },
            { 
                id: 'SADT_URGENCIA', 
                label: 'SP/SADT Urgência', 
                url: `${baseURL}&tipoDeGuia=SP_SADT`,
                tipo: 'urgencia',
                prazoHoras: 6,
                limiteAlertaHoras: 1
            },
            { 
                id: 'OPME_URGENCIA', 
                label: 'OPME Urgência', 
                url: `${baseURL}&tipoDeGuia=SOLICITACAO_DE_OPME`,
                tipo: 'urgencia',
                prazoHoras: 6, 
                limiteAlertaHoras: 1
            }
        ];

        const filas = [...filasEletivas, ...filasUrgencias];

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        };

        const resultadosBrutos = await Promise.all(filas.map(async (fila) => {
            let page = 0;
            let totalPages = 1;
            let guiasBrutas = [];
            
            do {
                try {
                    const urlComPagina = `${fila.url}&page=${page}`;
                    const response = await fetch(urlComPagina, { headers });
                    
                    if (!response.ok) break;
                    
                    const json = await response.json();
                    const itensPagina = json.content || json.data || [];
                    
                    if (itensPagina.length > 0) {
                        guiasBrutas = guiasBrutas.concat(itensPagina);
                        if (json.totalPages !== undefined) totalPages = json.totalPages;
                    } else {
                        break;
                    }
                    page++;
                } catch (err) {
                    console.error(`❌ Erro na fila ${fila.label}:`, err.message);
                    break; 
                }
                await new Promise(resolve => setTimeout(resolve, 100)); 
            } while (page < totalPages);

            if (fila.id.includes('OPME')) {
                console.log(`[DEBUG OPME] Fila ${fila.label}: API retornou ${guiasBrutas.length} guias.`);
            }

            const statusPermitidos = ['EM_ANALISE', 'EM_REANALISE', 'DOCUMENTACAO_EM_ANALISE'];

            const guiasValidas = guiasBrutas.filter(guia => {
          
                const rawStatus = guia.status || guia.statusRegulacao || guia.situacao;
                const status = rawStatus ? String(rawStatus).toUpperCase().trim() : '';
                if (!statusPermitidos.includes(status)) return false;

                const nomeFila = (guia.fila || '').toUpperCase();
                const nomePrestador = (guia.prestador || '').toUpperCase();
                
                if (fila.id !== 'PRORROGACAO') {
                    if (nomeFila.includes('HOME CARE') || nomePrestador.includes('HOME CARE')) return false; 
                }

                const ehGuiaDeOpme = fila.url.includes('SOLICITACAO_DE_OPME') || 
                                     nomeFila.includes('OPME') || 
                                     (guia.area === 'OPME') || 
                                     (guia.tipoDeGuia === 'SOLICITACAO_DE_OPME');

                if (fila.id !== 'PRORROGACAO') {
                    if (fila.id.includes('OPME')) {
                        if (!ehGuiaDeOpme) return false;
                    } 
                    else {
                        if (ehGuiaDeOpme) return false;
                    }
                }
                
                if (fila.id === 'PRORROGACAO') {
                    return true;
                }

                if (fila.id.includes('OPME')) {
                    const dataSolicitacao = new Date(guia.dataHoraSolicitacao || guia.dataSolicitacao);
                    const dataVencimento = new Date(guia.dataVencimentoSla || guia.dataVencimento);
                    
                    if (isNaN(dataSolicitacao) || isNaN(dataVencimento)) {
                        return fila.tipo === 'eletiva'; 
                    }

                    const prazoTotalHoras = (dataVencimento - dataSolicitacao) / (1000 * 60 * 60);
                    const isOPMEUrgencia = prazoTotalHoras < 7; 
                    
                    if (fila.tipo === 'urgencia') return isOPMEUrgencia;
                    else return !isOPMEUrgencia;
                }
                
                // Lógica padrão Internação/SADT
                const isUrgencia = nomeFila.includes('URGÊNCIA') || 
                                   nomeFila.includes('EMERGÊNCIA') ||
                                   nomeFila.includes('URGENCIA');
                
                if (fila.tipo === 'urgencia' && !isUrgencia) return false;
                if (fila.tipo === 'eletiva' && isUrgencia) return false;

                return true;
            });

            if (fila.id.includes('OPME')) {
                console.log(`[DEBUG OPME] Fila ${fila.label}: ${guiasValidas.length} guias válidas após filtros.`);
            }

            // 5. ESTATÍSTICAS
            let total = guiasValidas.length;
            let dentroPrazo = 0;
            let totalVencidas = 0;
            let totalProximas = 0;
            let listaVencidas = [];
            let listaProximas = [];

            guiasValidas.forEach(guia => {
                const numeroGuia = guia.autorizacaoGuia || guia.numeroGuia || 'S/N';
                
                const apiDizQueEstaAtrasada = guia.atrasada === true || 
                                              (guia.situacaoSla && String(guia.situacaoSla).includes('ATRASO'));

                if (apiDizQueEstaAtrasada) {
                    totalVencidas++;
                    listaVencidas.push(numeroGuia);
                } else {
                    dentroPrazo++; 

                    if (fila.id === 'PRORROGACAO') {
                    } else {
                        let dataVencimento = null;
                        if (guia.dataVencimentoSla || guia.dataVencimento) {
                            dataVencimento = new Date(guia.dataVencimentoSla || guia.dataVencimento);
                        } else if (guia.dataSolicitacao && fila.prazoHoras) {
                            dataVencimento = new Date(guia.dataSolicitacao);
                            dataVencimento.setHours(dataVencimento.getHours() + fila.prazoHoras);
                        }

                        if (dataVencimento) {
                            const agora = new Date();
                            const diffMs = dataVencimento - agora;
                            
                            if (diffMs > 0 && diffMs <= (fila.limiteAlertaHoras * 60 * 60 * 1000)) {
                                totalProximas++;
                                listaProximas.push(numeroGuia);
                            }
                        }
                    }
                }
            });

            const percentualSLA = total > 0 ? ((dentroPrazo / total) * 100).toFixed(1) : 100;

            return {
                id: fila.id,
                tipo: fila.tipo,
                label: fila.label,
                total: total,
                percentualSLA: percentualSLA,
                totalVencidas: totalVencidas,
                totalProximas: totalProximas,
                listaVencidas: listaVencidas,
                listaProximas: listaProximas,
                status: parseFloat(percentualSLA) < 90 ? 'danger' : (parseFloat(percentualSLA) < 98 ? 'warning' : 'success')
            };
        }));

        const dadosFinais = {
            eletivas: resultadosBrutos.filter(r => r.tipo === 'eletiva'),
            urgencias: resultadosBrutos.filter(r => r.tipo === 'urgencia')
        };

        res.json({ success: true, data: dadosFinais });

    } catch (error) {
        console.error('❌ Erro na rota sla-tempo-real:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
router.get('/guias-negadas', async (req, res) => {
    try {
        const { search, startDate, endDate } = req.query;
        let query = `
            SELECT * FROM public.regulacao_issec 
            WHERE jsonb_array_length(itens_guia) > 0 
            AND status_regulacao != 'CANCELADA'
        `;
        const values = [];

        if (startDate && endDate) {
            values.push(startDate, endDate);
            query += ` AND data_regulacao BETWEEN $${values.length - 1} AND $${values.length}`;
        }

        if (search) {
            values.push(`%${search}%`);
            query += ` AND (autorizacao_guia ILIKE $${values.length} OR prestador ILIKE $${values.length})`;
        }

        const result = await req.pool.query(query, values);
        
        const formatado = result.rows.map(row => ({
            _id: row.id_guia_cliente,
            numeroGuiaOperadora: row.autorizacao_guia,
            dataRegulacao: row.data_regulacao,
            prestadorNome: row.prestador,
            totalNegado: row.itens_guia.reduce((sum, i) => sum + (parseFloat(i.valorNegado) || 0), 0),
            itensGuia: row.itens_guia
        }));

        res.json({ success: true, data: formatado, total: formatado.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/estatisticas', async (req, res) => {
    try {
        console.log('📈 Calculando estatísticas no NeonDB...');
        const { startDate, endDate } = req.query;
        
        const result = await req.pool.query(`
            SELECT itens_guia, prestador, tipo_de_guia 
            FROM public.regulacao_issec 
            WHERE data_regulacao BETWEEN $1 AND $2 
            AND status_regulacao != 'CANCELADA'
            AND jsonb_array_length(itens_guia) > 0`, 
            [startDate, endDate]
        );

        const guiasEncontradas = result.rows;

        let totalGeralNegado = 0;
        let totalGeralAutorizado = 0; 
        let quantidadeGuias = 0;
        let maiorNegativa = 0;
        
        const procedimentosMap = new Map();
        const prestadoresMap = new Map();
        const tiposGuiaMap = new Map();
        
        for (const row of guiasEncontradas) {
            let totalNegadoGuia = 0;
            let totalAutorizadoGuia = 0; 
            let temNegativa = false;
            
            const itens = row.itens_guia || [];
            
            for (const item of itens) {
                const valorNegado = parseFloat(item.valorNegado || 0);
                const valorUnitario = parseFloat(item.valorUnitarioProcedimento || 0);
                const quantAutorizada = parseFloat(item.quantAutorizada || 0);
                
                const valorAutorizadoItem = valorUnitario * quantAutorizada;
                totalAutorizadoGuia += valorAutorizadoItem;

                if (valorNegado > 0.01) {
                    totalGeralNegado += valorNegado;
                    totalNegadoGuia += valorNegado;
                    temNegativa = true;

                    const codigo = item.codigo || 'N/A';
                    const atualProcedimento = procedimentosMap.get(codigo) || {
                        descricao: item.descricao || 'N/A',
                        totalNegado: 0,
                        totalOcorrencias: 0
                    };
                    
                    atualProcedimento.totalNegado += valorNegado;
                    atualProcedimento.totalOcorrencias += 1;
                    procedimentosMap.set(codigo, atualProcedimento);
                }
            }
            
            totalGeralAutorizado += totalAutorizadoGuia;
            
            if (temNegativa) {
                quantidadeGuias++;
                maiorNegativa = Math.max(maiorNegativa, totalNegadoGuia);
                
                const prestadorNome = row.prestador || 'Prestador Não Informado';
                const atualPrestador = prestadoresMap.get(prestadorNome) || { totalNegado: 0, quantidadeGuias: 0 };
                atualPrestador.totalNegado += totalNegadoGuia;
                atualPrestador.quantidadeGuias += 1;
                prestadoresMap.set(prestadorNome, atualPrestador);
                
                const tipoGuia = row.tipo_de_guia || 'Tipo Não Informado';
                const atualTipoGuia = tiposGuiaMap.get(tipoGuia) || { totalNegado: 0, quantidadeGuias: 0 };
                atualTipoGuia.totalNegado += totalNegadoGuia;
                atualTipoGuia.quantidadeGuias += 1;
                tiposGuiaMap.set(tipoGuia, atualTipoGuia);
            }
        }
        
        const topNegados = Array.from(procedimentosMap.entries())
            .map(([codigo, data]) => ({ codigo, ...data }))
            .sort((a, b) => b.totalNegado - a.totalNegado).slice(0, 10);
            
        const topPrestadores = Array.from(prestadoresMap.entries())
            .map(([prestador, data]) => ({ prestador, ...data }))
            .sort((a, b) => b.totalNegado - a.totalNegado).slice(0, 10);
            
        const topTiposGuia = Array.from(tiposGuiaMap.entries())
            .map(([tipoGuia, data]) => ({ tipoGuia, ...data }))
            .sort((a, b) => b.totalNegado - a.totalNegado);

        const valorMedio = quantidadeGuias > 0 ? totalGeralNegado / quantidadeGuias : 0;

        res.json({
            success: true,
            data: { 
                totalGeralNegado, 
                totalGeralAutorizado, 
                quantidadeGuias, 
                valorMedio, 
                maiorNegativa, 
                topNegados, 
                topPrestadores, 
                topTiposGuia 
            }
        });
        
    } catch (error) {
        console.error('❌ Erro ao calcular estatísticas no NeonDB:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/sla-desempenho', async (req, res) => {
    try {
        console.log('🔄 Calculando estatísticas de SLA e Comparativo no NeonDB...');
        const { startDate, endDate } = req.query;
        
        let query = `
            SELECT tipo_de_guia, situacao_sla, regulada_automaticamente, reguladores, data_regulacao 
            FROM public.regulacao_issec 
            WHERE status_regulacao IS NOT NULL
        `;
        const values = [];

        if (startDate && endDate) {
            values.push(startDate, endDate);
            query += ` AND data_regulacao BETWEEN $1 AND $2`;
        }

        const result = await req.pool.query(query, values);
        const guiasEncontradas = result.rows;
        
        const statsPorTipo = new Map();
        const statsPorRegulador = new Map();
        const statsPorData = new Map();
        const comparativoIA_PorData = new Map(); 
        
        let totalYmir = 0, totalGabriel = 0, totalOutros = 0, totalGeralIA = 0;
        let filtroInicio = startDate ? new Date(startDate) : null;
        let filtroFim = endDate ? new Date(endDate) : null;

        for (const guia of guiasEncontradas) {
            const situacaoSla = guia.situacao_sla;
            const reguladaAuto = guia.regulada_automaticamente;
            const reguladores = guia.reguladores || [];
            const dataRegulacao = guia.data_regulacao;

            let dentroSLA = true;
            if (situacaoSla === 'REGULADA_COM_ATRASO') dentroSLA = false;
            else if (situacaoSla === 'REGULADA_NO_PRAZO' || reguladaAuto === true) dentroSLA = true;

            const tipoGuia = guia.tipo_de_guia || 'NÃO CLASSIFICADO';
            const tipoStats = statsPorTipo.get(tipoGuia) || { total: 0, dentroSLA: 0 };
            tipoStats.total++;
            if (dentroSLA) tipoStats.dentroSLA++;
            statsPorTipo.set(tipoGuia, tipoStats);

            let semana = null;
            if (dataRegulacao) {
                const dataString = new Date(dataRegulacao).toISOString().split('T')[0];
                semana = getInicioSemana(dataString);
                
                const dataStats = statsPorData.get(semana) || { total: 0, dentroSLA: 0 };
                dataStats.total++;
                if (dentroSLA) dataStats.dentroSLA++;
                statsPorData.set(semana, dataStats);
            }

            let reguladorIdentificado = null; 

            if (reguladores.length === 0 && reguladaAuto) {
                const nomeIA = 'YMIR (IA)';
                const regStats = statsPorRegulador.get(nomeIA) || { total: 0, dentroSLA: 0 };
                regStats.total++;
                if (dentroSLA) regStats.dentroSLA++;
                statsPorRegulador.set(nomeIA, regStats);

                reguladorIdentificado = 'Ymir';
                totalYmir++;
                totalGeralIA++;
            } 
            else if (reguladores.length > 0) {
                for (const regObj of reguladores) {
                    let nome = (regObj.nomeRegulador || 'Regulador Desconhecido')
                               .toLowerCase().replace(/[^a-zÀ-ÿ\s]/g, '').replace(/\s+/g, ' ').trim();
                    
                    const regStats = statsPorRegulador.get(nome) || { total: 0, dentroSLA: 0 };
                    regStats.total++;
                    if (dentroSLA) regStats.dentroSLA++;
                    statsPorRegulador.set(nome, regStats);

                    if (nome.includes('gabriel costa campos')) {
                        reguladorIdentificado = 'Gabriel';
                        totalGabriel++; 
                    } else {
                        reguladorIdentificado = 'Outros';
                        totalOutros++;
                    }
                    totalGeralIA++;
                }
            }

            if (semana && reguladorIdentificado) {
                const dadosSemana = comparativoIA_PorData.get(semana) || { ymir: 0, gabriel: 0, outros: 0 };
                if (reguladorIdentificado === 'Ymir') dadosSemana.ymir++;
                else if (reguladorIdentificado === 'Gabriel') dadosSemana.gabriel++;
                else dadosSemana.outros++;
                comparativoIA_PorData.set(semana, dadosSemana);
            }
        }

        let totalGuiasSLA = 0;
        let totalDentroSLA = 0;
        for (const stats of statsPorTipo.values()) {
            totalGuiasSLA += stats.total;
            totalDentroSLA += stats.dentroSLA;
        }
        
        const slaGeral = (totalGuiasSLA > 0) ? ((totalDentroSLA / totalGuiasSLA) * 100).toFixed(2) : "0.00";

        const slaPorTipo = Array.from(statsPorTipo.entries()).map(([tipo, data]) => ({
            tipo: tipo.replace(/_/g, ' '),
            total: data.total,
            dentroSLA: data.dentroSLA,
            foraSLA: data.total - data.dentroSLA,
            percentualSLA: data.total > 0 ? ((data.dentroSLA / data.total) * 100).toFixed(2) : "0.00"
        })).sort((a, b) => b.total - a.total);

        const tendenciaSLA = Array.from(statsPorData.entries()).map(([data, stats]) => ({
            data: data,
            percentualSLA: stats.total > 0 ? ((stats.dentroSLA / stats.total) * 100) : 0
        })).sort((a, b) => a.data.localeCompare(b.data));

        const desempenhoReguladores = Array.from(statsPorRegulador.entries())
            .map(([nome, data]) => ({
                nome: nome.includes('gabriel costa campos') ? 'Robô (Gabriel)' : (nome === 'ymir ia' ? 'YMIR (IA)' : nome),
                total: data.total, 
                dentroSLA: data.dentroSLA,
                percentualSLA: data.total > 0 ? ((data.dentroSLA / data.total) * 100).toFixed(1) : "0.0" 
            }))
            .sort((a, b) => b.total - a.total);

        res.json({
            success: true,
            data: { 
                totalGuiasSLA, 
                slaGeral, 
                slaPorTipo, 
                tendenciaSLA, 
                desempenhoReguladores,
                comparativoIA: {
                    timeline: Array.from(comparativoIA_PorData.entries()).map(([data, c]) => ({ data, ymir: c.ymir, gabriel: c.gabriel, outros: c.outros })).sort((a,b) => a.data.localeCompare(b.data)),
                    share: {
                        ymir: totalGeralIA > 0 ? ((totalYmir / totalGeralIA) * 100).toFixed(1) : "0.0",
                        gabriel: totalGeralIA > 0 ? ((totalGabriel / totalGeralIA) * 100).toFixed(1) : "0.0",
                        outros: totalGeralIA > 0 ? ((totalOutros / totalGeralIA) * 100).toFixed(1) : "0.0"
                    }
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Erro ao calcular estatísticas de SLA no NeonDB:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


module.exports = router;
