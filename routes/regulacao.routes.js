const express = require('express');
const router = express.Router();

// ------------------------------------------------------------------------------------------------
// FUNÇÕES AUXILIARES
// ------------------------------------------------------------------------------------------------

function getInicioSemana(dateString) {
    // Adiciona T12:00:00 para evitar problemas de fuso horário (UTC)
    const data = new Date(dateString + 'T12:00:00Z'); 
    const diaDaSemana = data.getUTCDay(); // 0 = Domingo, 1 = Segunda...
    const diff = data.getUTCDate() - diaDaSemana;
    const inicioSemana = new Date(data.setUTCDate(diff));
    return inicioSemana.toISOString().split('T')[0]; // Retorna YYYY-MM-DD
}

// --------------------------
// SLA EM TEMPO REAL 
// -------------------------
router.get('/sla-tempo-real', async (req, res) => {
    try {
        console.log('🔄 Iniciando monitoramento de SLA em Tempo Real...');

        // 1. OBTER TOKEN DE ACESSO
        const GAS_TOKEN_URL = process.env.GAS_TOKEN_URL; 
        let authToken = '';

        try {
            const urlToken = GAS_TOKEN_URL;
            const tokenResponse = await fetch(urlToken);
            if (!tokenResponse.ok) throw new Error('Falha ao obter token do GAS');
            const tokenData = await tokenResponse.json();
            authToken = tokenData.token || tokenData.accessToken || tokenData; 
            console.log('✅ Token obtido com sucesso');
        } catch (tokenError) {
            console.error('❌ Erro fatal: Não foi possível obter o token.', tokenError);
            return res.status(500).json({ success: false, error: 'Falha na autenticação externa' });
        }

        // 2. CONFIGURAÇÃO DAS FILAS
        const baseURL = 'https://regulacao-api.issec.maida.health/v3/historico-cliente?ordenarPor=DATA_SOLICITACAO&listaDeStatus=EM_ANALISE,EM_REANALISE,DOCUMENTACAO_EM_ANALISE&size=20';
        
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
                id: 'PRORROGACAO_ELETIVA', 
                label: 'Prorrogação Eletiva', 
                url: `${baseURL}&tipoDeGuia=PRORROGACAO_DE_INTERNACAO`,
                tipo: 'eletiva',
                prazoHoras: 24,
                limiteAlertaHoras: 4
            },
            { 
                id: 'OPME_ELETIVA', 
                label: 'OPME Eletiva', 
                url: `${baseURL}&tipoDeGuia=SOLICITACAO_DE_OPME,PRORROGACAO_DE_INTERNACAO`,
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
                id: 'PRORROGACAO_URGENCIA', 
                label: 'Prorrogação Urgência', 
                url: `${baseURL}&tipoDeGuia=PRORROGACAO_DE_INTERNACAO`,
                tipo: 'urgencia',
                prazoHoras: 24,
                limiteAlertaHoras: 4
            },
            { 
                id: 'OPME_URGENCIA', 
                label: 'OPME Urgência', 
                url: `${baseURL}&tipoDeGuia=SOLICITACAO_DE_OPME,PRORROGACAO_DE_INTERNACAO`,
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

        // 3. BUSCAR DADOS
        const resultadosBrutos = await Promise.all(filas.map(async (fila) => {
            console.log(`\n🔍 Buscando fila: ${fila.label}`);
            
            let page = 0;
            let totalPages = 1;
            let guiasBrutas = [];
            let requestsCount = 0;
            
            // Loop de paginação para buscar todas as guias da fila
            do {
                try {
                    requestsCount++;
                    const urlComPagina = `${fila.url}&page=${page}`;
                    
                    const response = await fetch(urlComPagina, { headers });
                    
                    if (response.status === 401 || response.status === 403) { 
                        console.error(`⛔ Erro de Permissão na fila ${fila.label}. Status: ${response.status}`);
                        break; 
                    }
                    
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

            // 4. FILTRAGEM POR STATUS E REGRAS DE NEGÓCIO
            const agora = new Date();
            const statusPermitidos = ['EM_ANALISE', 'EM_REANALISE'];

            // Lógica de filtragem corrigida e limpa
            const guiasValidas = guiasBrutas.filter(guia => {
                // 1. Validação de Status
                const rawStatus = guia.status || guia.statusRegulacao || guia.situacao;
                const status = rawStatus ? String(rawStatus).toUpperCase().trim() : '';
                if (!statusPermitidos.includes(status)) return false;

                // Variáveis auxiliares para as regras
                const nomeFila = (guia.fila || '').toUpperCase();
                const nomePrestador = (guia.prestador || '').toUpperCase();
                const nomeArea = (guia.area || '').toUpperCase();

                // 2. REGRA DE EXCLUSÃO: HOME CARE
                // Se for Home Care (na fila ou no prestador), removemos de TUDO.
                if (nomeFila.includes('HOME CARE') || nomePrestador.includes('HOME CARE')) {
                    return false; 
                }

                // 3. REGRA DE ROTEAMENTO: OPME
                // Uma guia é considerada OPME se a fila tem 'OPME' OU a área é 'OPME'
                const ehGuiaDeOpme = nomeFila.includes('OPME') || nomeArea === 'OPME';
                const estouNoCardDeOpme = fila.id.includes('OPME');

                if (estouNoCardDeOpme) {
                    // Se estou no card de OPME, SÓ aceito guias que sejam de OPME (mesmo que sejam Prorrogação)
                    if (!ehGuiaDeOpme) return false;
                } else {
                    // Se estou em OUTROS cards (Internação, Prorrogação, SADT), 
                    // REJEITO se a guia for de OPME (pois ela deve ir para o card de OPME)
                    if (ehGuiaDeOpme) return false;
                }
                
                // 4. Lógica de filtragem por Urgência/Eletiva
                // A lógica abaixo determina se a guia é urgência para classificar nos buckets corretos
                
                // Se for OPME (já sabemos que está no bucket certo devido ao passo 3), usamos o prazo
                if (fila.id.includes('OPME')) {
                    const dataSolicitacaoRaw = guia.dataHoraSolicitacao || guia.dataSolicitacao;
                    const dataVencimentoRaw = guia.dataVencimentoSla || guia.dataVencimento;
                    
                    if (!dataSolicitacaoRaw || !dataVencimentoRaw) return true; // Na dúvida, exibe
                    
                    const dataSolicitacao = new Date(dataSolicitacaoRaw);
                    const dataVencimento = new Date(dataVencimentoRaw);
                    const prazoTotalHoras = (dataVencimento - dataSolicitacao) / (1000 * 60 * 60);
                    
                    const isOPMEUrgencia = prazoTotalHoras < 7; 
                    
                    if (fila.tipo === 'urgencia') return isOPMEUrgencia;
                    else return !isOPMEUrgencia;
                }
                
                // Se NÃO for OPME (Internação, SADT, Prorrogação Comum)
                const isUrgencia = nomeFila.includes('URGÊNCIA') || 
                                   nomeFila.includes('EMERGÊNCIA') ||
                                   nomeFila.includes('URGENCIA');
                
                if (fila.tipo === 'urgencia' && !isUrgencia) return false;
                if (fila.tipo === 'eletiva' && isUrgencia) return false;

                return true;
            });

            // 5. CÁLCULO DE ESTATÍSTICAS (Baseado nas guias filtradas)
            let total = guiasValidas.length;
            let dentroPrazo = 0;
            let totalVencidas = 0;
            let totalProximas = 0;
            let listaVencidas = [];
            let listaProximas = [];

            guiasValidas.forEach(guia => {
                let dataVencimento = null;
                
                // Prioriza o vencimento fornecido pela API
                if (guia.dataVencimentoSla || guia.dataVencimento) {
                    dataVencimento = new Date(guia.dataVencimentoSla || guia.dataVencimento);
                } 
                // Fallback apenas se não for OPME (pois OPME já calculamos acima ou confiamos na API)
                else if (guia.dataSolicitacao && fila.prazoHoras && !fila.id.includes('OPME')) {
                    dataVencimento = new Date(guia.dataSolicitacao);
                    dataVencimento.setHours(dataVencimento.getHours() + fila.prazoHoras);
                }

                if (dataVencimento) {
                    const agora = new Date();
                    const diffMs = dataVencimento - agora; 
                    const diffHoras = diffMs / (1000 * 60 * 60);
                    const numeroGuia = guia.autorizacaoGuia || guia.numeroGuia || 'S/N';

                    if (diffMs <= 0) {
                        // JÁ VENCEU
                        totalVencidas++;
                        listaVencidas.push(numeroGuia);
                    } else if (diffMs <= (fila.limiteAlertaHoras * 60 * 60 * 1000)) {
                        // PRÓXIMA DO VENCIMENTO
                        totalProximas++;
                        listaProximas.push(numeroGuia);
                    } else {
                        // DENTRO DO PRAZO
                        dentroPrazo++;
                    }
                } else {
                    // Se não tem data de vencimento, consideramos dentro do prazo por padrão
                    dentroPrazo++;
                }
            });

            const percentualSLA = total > 0 ? ((dentroPrazo / total) * 100).toFixed(1) : 100;

            console.log(`📊 ${fila.label}: ${total} guias, ${dentroPrazo} dentro do prazo`);

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

        console.log('\n🎉 PROCESSAMENTO CONCLUÍDO');

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
module.exports = router;
router.get('/guias-negadas', async (req, res) => {
    try {
        console.log('🔍 Buscando guias negadas com filtros...');
        
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

        const guiasEncontradas = await guiasCollection.find(query).toArray();
        
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
        let totalGeralAutorizado = 0; 
        let quantidadeGuias = 0;
        let maiorNegativa = 0;
        const procedimentosMap = new Map();
        const prestadoresMap = new Map();
        const tiposGuiaMap = new Map();
        
        for (const guia of guiasEncontradas) {
            let totalNegadoGuia = 0;
            let totalAutorizadoGuia = 0; 
            let temNegativa = false;
            
            for (const item of guia.itensGuia || []) {
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
        console.error('❌ Erro ao calcular estatísticas:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

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

        const comparativoIA_PorData = new Map(); 
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

            const reguladores = guia.reguladores || [];
            let reguladorIdentificado = 'Outros'; 

            if (reguladores.length === 0 && guia.reguladaAutomaticamente) {
                const nomeIA = 'YMIR (IA)';
                const regStats = statsPorRegulador.get(nomeIA) || { total: 0, dentroSLA: 0 };
                regStats.total++;
                if (dentroSLA) regStats.dentroSLA++;
                statsPorRegulador.set(nomeIA, regStats);

                reguladorIdentificado = 'Ymir';
                totalYmir++;
            } 
            else if (reguladores.length > 0) {
                for (const reguladorObj of reguladores) {
                    let nome = reguladorObj.nomeRegulador || 'Regulador Desconhecido';

                    nome = nome.toLowerCase().replace(/[^a-zÀ-ÿ\s]/g, '').replace(/\s+/g, ' ').trim();
                    const nomeOriginalFormatado = reguladorObj.nomeRegulador ? reguladorObj.nomeRegulador.trim() : 'Desconhecido';

                    const regStats = statsPorRegulador.get(nome) || { total: 0, dentroSLA: 0 };
                    regStats.total++;
                    if (dentroSLA) regStats.dentroSLA++;
                    statsPorRegulador.set(nome, regStats);

                    if (nome.includes('gabriel costa campos')) {
                        reguladorIdentificado = 'Gabriel';
                        totalGabriel++; 
                    } else {
                        totalOutros++;
                    }
                }
            } else {
                totalOutros++; 
            }
            
            totalGeralIA++;

            if (semana) {
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
