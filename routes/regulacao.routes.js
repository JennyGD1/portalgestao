const express = require('express');
const router = express.Router();

// ------------------------------------------------------------------------------------------------
// FUNÇÕES AUXILIARES
// (Movidas do server.js para cá, pois só são usadas nestas rotas)
// ------------------------------------------------------------------------------------------------

function getInicioSemana(dateString) {
    // Adiciona T12:00:00 para evitar problemas de fuso horário (UTC)
    const data = new Date(dateString + 'T12:00:00Z'); 
    const diaDaSemana = data.getUTCDay(); // 0 = Domingo, 1 = Segunda...
    const diff = data.getUTCDate() - diaDaSemana;
    const inicioSemana = new Date(data.setUTCDate(diff));
    return inicioSemana.toISOString().split('T')[0]; // Retorna YYYY-MM-DD
}

// ------------------------------------------------------------------------------------------------
// Rota API: guias-negadas
// ------------------------------------------------------------------------------------------------
router.get('/guias-negadas', async (req, res) => {
    try {
        console.log('🔍 Buscando guias negadas com filtros...');
        
        // ACESSO AO BANCO: Usamos req.db injetado pelo server.js
        const guiasCollection = req.db.collection('guias');

        const { search, startDate, endDate } = req.query;
        
        const query = { 
            "itensGuia": { $exists: true, $ne: [] },
            "statusRegulacao": { $ne: 'CANCELADA' }
        };
        
        if (startDate && endDate) {
            query.dataRegulacao = {
                $gte: startDate,
                $lte: endDate
            };
        }
        
        if (search) {
            query.$or = [
                { autorizacaoGuia: new RegExp(search, 'i') }, 
                { "itensGuia.codigo": new RegExp(search, 'i') },
                { "prestador": new RegExp(search, 'i') }
            ];
        }

        const guiasEncontradas = await guiasCollection.find(query)
            .sort({ dataRegulacao: -1 })
            .limit(2000) 
            .toArray();
        
        const resultado = [];
        
        for (const guia of guiasEncontradas) {
            const itens = guia.itensGuia || [];
            const itensNegados = [];
            let totalNegadoGuia = 0;
            
            for (const item of itens) {
                const valorNegado = parseFloat(item.valorNegado || 0);
                
                if (valorNegado > 0.01) { 
                    const quantNegada = item.quantNegada || (item.quantSolicitada - (item.quantAutorizada || 0));
                    
                    itensNegados.push({
                        codigo: item.codigo || 'N/A',
                        descricao: item.descricao || 'Descrição não disponível',
                        quantSolicitada: item.quantSolicitada || 0,
                        quantAutorizada: item.quantAutorizada || 0,
                        quantNegada: quantNegada,
                        valorUnitario: item.valorUnitarioProcedimento || 0,
                        valorTotalNegado: valorNegado,
                    });
                    totalNegadoGuia += valorNegado;
                }
            }
            
            if (itensNegados.length > 0) {
                resultado.push({
                    _id: guia._id,
                    numeroGuiaOperadora: guia.autorizacaoGuia || 'N/A',
                    dataSolicitacao: guia.dataSolicitacao,
                    dataRegulacao: guia.dataRegulacao || 'N/A',
                    status: guia.statusRegulacao || 'Status N/A',
                    prestadorNome: guia.prestador || 'Prestador N/A',
                    totalNegado: totalNegadoGuia,
                    itensGuia: itensNegados
                });
            }
        }
        
        resultado.sort((a, b) => b.totalNegado - a.totalNegado);
        
        res.json({ success: true, data: resultado, total: resultado.length });
        
    } catch (error) {
        console.error('❌ Erro ao buscar guias negadas:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ------------------------------------------------------------------------------------------------
// Rota API: estatisticas 
// ------------------------------------------------------------------------------------------------
router.get('/estatisticas', async (req, res) => {
    try {
        console.log('📈 Calculando estatísticas...');
        const guiasCollection = req.db.collection('guias');
        
        const { startDate, endDate } = req.query;
        
        const dateQuery = {};
        if (startDate && endDate) {
             dateQuery.dataRegulacao = { $gte: startDate, $lte: endDate };
        }
        
        const baseMatch = { 
            ...dateQuery, 
            "itensGuia": { $exists: true, $ne: [] },
            "statusRegulacao": { $ne: 'CANCELADA' } 
        };
        
        const guiasEncontradas = await guiasCollection.find(baseMatch).toArray();
        
        let totalGeralNegado = 0;
        let quantidadeGuias = 0;
        let maiorNegativa = 0;
        const procedimentosMap = new Map();
        const prestadoresMap = new Map();
        const tiposGuiaMap = new Map();
        
        for (const guia of guiasEncontradas) {
            let totalNegadoGuia = 0;
            let temNegativa = false;
            
            for (const item of guia.itensGuia || []) {
                const valorNegado = parseFloat(item.valorNegado || 0);

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
            
            if (temNegativa) {
                quantidadeGuias++;
                maiorNegativa = Math.max(maiorNegativa, totalNegadoGuia);
                
                const prestadorNome = guia.prestador || 'Prestador Não Informado';
                const atualPrestador = prestadoresMap.get(prestadorNome) || { totalNegado: 0, quantidadeGuias: 0 };
                atualPrestador.totalNegado += totalNegadoGuia;
                atualPrestador.quantidadeGuias += 1;
                prestadoresMap.set(prestadorNome, atualPrestador);
                
                const tipoGuia = guia.tipoDeGuia || 'Tipo Não Informado';
                const atualTipoGuia = tiposGuiaMap.get(tipoGuia) || { totalNegado: 0, quantidadeGuias: 0 };
                atualTipoGuia.totalNegado += totalNegadoGuia;
                atualTipoGuia.quantidadeGuias += 1;
                tiposGuiaMap.set(tipoGuia, atualTipoGuia);
            }
        }
        
        // Processamentos Top 10 e ordenações (código mantido igual ao original)
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
            data: { totalGeralNegado, quantidadeGuias, valorMedio, maiorNegativa, topNegados, topPrestadores, topTiposGuia }
        });
        
    } catch (error) {
        console.error('❌ Erro ao calcular estatísticas:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ------------------------------------------------------------------------------------------------
// Rota API: sla-desempenho (ATUALIZADA COM IA vs GABRIEL)
// ------------------------------------------------------------------------------------------------
router.get('/sla-desempenho', async (req, res) => {
    try {
        console.log('🔄 Calculando estatísticas de SLA e Comparativo IA...');
        const guiasCollection = req.db.collection('guias');
        
        const { startDate, endDate } = req.query;
        
        const dateQuery = {};
        if (startDate && endDate) {
             dateQuery.dataRegulacao = { $gte: startDate, $lte: endDate };
        }
        
        const baseMatch = { ...dateQuery, "statusRegulacao": { $exists: true } };
        
        const guiasEncontradas = await guiasCollection.find(baseMatch).project({
            tipoDeGuia: 1, situacaoSla: 1, reguladaAutomaticamente: 1, reguladores: 1, dataRegulacao: 1
        }).toArray();
        
        const statsPorTipo = new Map();
        const statsPorRegulador = new Map();
        const statsPorData = new Map();

        // Novas estruturas para o Comparativo IA
        const comparativoIA_PorData = new Map(); // Chave: Data, Valor: { ymir: 0, gabriel: 0, outros: 0 }
        let totalYmir = 0;
        let totalGabriel = 0;
        let totalOutros = 0;
        let totalGeralIA = 0;

        for (const guia of guiasEncontradas) {
            let dentroSLA = true;
            if (guia.situacaoSla === 'REGULADA_COM_ATRASO') dentroSLA = false;
            else if (guia.situacaoSla === 'REGULADA_NO_PRAZO') dentroSLA = true;
            else if (guia.reguladaAutomaticamente === true) dentroSLA = true;

            const tipoGuia = guia.tipoDeGuia || 'NÃO CLASSIFICADO';
            const tipoStats = statsPorTipo.get(tipoGuia) || { total: 0, dentroSLA: 0 };
            tipoStats.total++;
            if (dentroSLA) tipoStats.dentroSLA++;
            statsPorTipo.set(tipoGuia, tipoStats);

            let semana = null;
            if (guia.dataRegulacao) {
                const data = guia.dataRegulacao.substring(0, 10); 
                semana = getInicioSemana(data);
                const dataStats = statsPorData.get(semana) || { total: 0, dentroSLA: 0 };
                dataStats.total++;
                if (dentroSLA) dataStats.dentroSLA++;
                statsPorData.set(semana, dataStats);
            }

            // --- LÓGICA DE REGULADORES E IA ---
            const reguladores = guia.reguladores || [];
            let reguladorIdentificado = 'Outros'; // Default para contagem temporal

            // 1. Lógica para IA YMIR
            if (reguladores.length === 0 && guia.reguladaAutomaticamente) {
                const nomeIA = 'YMIR (IA)';
                const regStats = statsPorRegulador.get(nomeIA) || { total: 0, dentroSLA: 0 };
                regStats.total++;
                if (dentroSLA) regStats.dentroSLA++;
                statsPorRegulador.set(nomeIA, regStats);

                reguladorIdentificado = 'Ymir';
                totalYmir++;
            } 
            // 2. Lógica para Reguladores Humanos
            else if (reguladores.length > 0) {
                for (const reguladorObj of reguladores) {
                    let nome = reguladorObj.nomeRegulador || 'Regulador Desconhecido';

                    // Normalização
                    nome = nome.toLowerCase().replace(/[^a-zÀ-ÿ\s]/g, '').replace(/\s+/g, ' ').trim();
                    const nomeOriginalFormatado = reguladorObj.nomeRegulador ? reguladorObj.nomeRegulador.trim() : 'Desconhecido';

                    const regStats = statsPorRegulador.get(nome) || { total: 0, dentroSLA: 0 };
                    regStats.total++;
                    if (dentroSLA) regStats.dentroSLA++;
                    statsPorRegulador.set(nome, regStats);

                    // Verifica se é o Gabriel
                    if (nome.includes('gabriel costa campos')) {
                        reguladorIdentificado = 'Gabriel';
                        totalGabriel++; // Incrementa aqui (cuidado com múltiplas regulações na mesma guia, aqui conta por regulador)
                    } else {
                        totalOutros++;
                    }
                }
            } else {
                totalOutros++; // Sem regulador e sem flag automática
            }
            
            totalGeralIA++;

            // --- POPULAR DADOS TEMPORAIS (COMPARATIVO) ---
            if (semana) {
                const dadosSemana = comparativoIA_PorData.get(semana) || { ymir: 0, gabriel: 0, outros: 0 };
                if (reguladorIdentificado === 'Ymir') dadosSemana.ymir++;
                else if (reguladorIdentificado === 'Gabriel') dadosSemana.gabriel++;
                else dadosSemana.outros++;
                
                comparativoIA_PorData.set(semana, dadosSemana);
            }
        }

        // --- Processamento Final ---
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
                nome: nome.includes('gabriel costa campos') ? 'Gabriel Costa Campos' : (nome === 'YMIR (IA)' ? nome : nome),
                total: data.total,
                dentroSLA: data.dentroSLA,
                foraSLA: data.total - data.dentroSLA,
                percentualSLA: data.total > 0 ? ((data.dentroSLA / data.total) * 100).toFixed(2) : "0.00"
            })).sort((a, b) => b.total - a.total);

        // Prepara dados do comparativo IA para o gráfico
        const comparativoTimeline = Array.from(comparativoIA_PorData.entries())
            .map(([data, counts]) => ({
                data,
                ymir: counts.ymir,
                gabriel: counts.gabriel,
                outros: counts.outros
            }))
            .sort((a, b) => a.data.localeCompare(b.data)); // Ordena por data

        // Percentuais finais
        const percentualYmir = totalGeralIA > 0 ? ((totalYmir / totalGeralIA) * 100).toFixed(1) : "0.0";
        const percentualGabriel = totalGeralIA > 0 ? ((totalGabriel / totalGeralIA) * 100).toFixed(1) : "0.0";
        const totalOutrosCalculado = totalGeralIA - totalYmir - totalGabriel;
        const percentualOutros = totalGeralIA > 0 ? ((totalOutrosCalculado / totalGeralIA) * 100).toFixed(1) : "0.0";

        res.json({
            success: true,
            data: { 
                totalGuiasSLA, 
                slaGeral, 
                slaPorTipo, 
                tendenciaSLA, 
                desempenhoReguladores,
                comparativoIA: {
                    timeline: comparativoTimeline,
                    share: {
                        ymir: percentualYmir,
                        gabriel: percentualGabriel,
                        outros: percentualOutros
                    }
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Erro ao calcular estatísticas de SLA:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

module.exports = router;
