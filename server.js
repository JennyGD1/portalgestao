const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); 

// Configuração do MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'guias_db';
const GUIAS_COLLECTION = 'guias';
const basicAuth = require('express-basic-auth');

let db, guiasCollection;

// Conectar ao MongoDB
async function connectToMongoDB() {
    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('✅ Conectado ao MongoDB');
        
        db = client.db(DB_NAME);
        guiasCollection = db.collection(GUIAS_COLLECTION);
        
        return client;
    } catch (error) {
        console.error('❌ Erro ao conectar ao MongoDB:', error);
        throw error;
    }
}

// ------------------------------------------------------------------------------------------------
// Rota API: guias-negadas
// ------------------------------------------------------------------------------------------------
app.get('/api/guias-negadas', async (req, res) => {
    try {
        console.log('🔍 Buscando guias negadas com filtros (Confiança total nos dados do DB)...');
        
        const { search, minValue, startDate, endDate } = req.query;
        
        // FILTRO BASE: Apenas buscar guias com itens. O filtro de negativa é feito em memória.
        const query = { "itensGuia": { $exists: true, $ne: [] } };
        
        // FILTRO DE DATA NO MONGODB
        if (startDate && endDate) {
            query.dataRegulacao = {
                $gte: startDate,
                $lte: endDate
            };
        }
        
        if (search) {
            // Busca no número da guia, código do item ou nome do prestador
            query.$or = [
                { autorizacaoGuia: new RegExp(search, 'i') }, 
                { "itensGuia.codigo": new RegExp(search, 'i') },
                { "prestador": new RegExp(search, 'i') } // Assume que o campo prestador é string, se for objeto, a busca será mais complexa.
            ];
        }

        // Busca todos os documentos que se enquadram nos filtros de busca e data
        const guiasEncontradas = await guiasCollection.find(query)
            .sort({ dataRegulacao: -1 })
            .limit(2000) 
            .toArray();
        
        const resultado = [];
        
        // ----------------------------------------------------------------------
        // FILTRAGEM E CÁLCULO EM MEMÓRIA (Confiança no campo valorNegado)
        // ----------------------------------------------------------------------
        for (const guia of guiasEncontradas) {
            const itens = guia.itensGuia || [];
            
            const itensNegados = [];
            let totalNegadoGuia = 0;
            
            for (const item of itens) {
                const valorNegado = parseFloat(item.valorNegado || 0);
                
                // CRITÉRIO DE NEGATIVA: valorNegado > 0 no item salvo
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
            
            
            // Só adiciona a guia se tiver itens negados
            if (itensNegados.length > 0) {
                resultado.push({
                    _id: guia._id,
                    numeroGuiaOperadora: guia.autorizacaoGuia || 'N/A', // Usando autorizacaoGuia
                    dataSolicitacao: guia.dataSolicitacao,
                    dataRegulacao: guia.dataRegulacao || 'N/A',
                    status: guia.statusRegulacao || 'Status N/A',
                    prestadorNome: guia.prestador || 'Prestador N/A', // Usando o campo prestador diretamente
                    totalNegado: totalNegadoGuia,
                    itensGuia: itensNegados
                });
            }
        }
        
        resultado.sort((a, b) => b.totalNegado - a.totalNegado);
        
        console.log(`📊 Encontradas ${resultado.length} guias com itens negados APÓS FILTRO`);
        
        res.json({
            success: true,
            data: resultado,
            total: resultado.length
        });
        
    } catch (error) {
        console.error('❌ Erro ao buscar guias negadas:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// ------------------------------------------------------------------------------------------------
// Rota API: estatisticas 
// ------------------------------------------------------------------------------------------------
app.get('/api/estatisticas', async (req, res) => {
    try {
        console.log('📈 Calculando estatísticas...');
        
        const { startDate, endDate } = req.query;
        
        const dateQuery = {};
        if (startDate && endDate) {
             dateQuery.dataRegulacao = {
                $gte: startDate,
                $lte: endDate
            };
        }
        
        const baseMatch = { ...dateQuery, "itensGuia": { $exists: true, $ne: [] } };
        
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

                    // Acumula dados para o Top 10 Procedimentos
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
                
                // Acumula dados para Prestadores
                const prestadorNome = guia.prestador || 'Prestador Não Informado';
                const atualPrestador = prestadoresMap.get(prestadorNome) || {
                    totalNegado: 0,
                    quantidadeGuias: 0
                };
                atualPrestador.totalNegado += totalNegadoGuia;
                atualPrestador.quantidadeGuias += 1;
                prestadoresMap.set(prestadorNome, atualPrestador);
                
                // Acumula dados para Tipos de Guia
                const tipoGuia = guia.tipoDeGuia || 'Tipo Não Informado';
                const atualTipoGuia = tiposGuiaMap.get(tipoGuia) || {
                    totalNegado: 0,
                    quantidadeGuias: 0
                };
                atualTipoGuia.totalNegado += totalNegadoGuia;
                atualTipoGuia.quantidadeGuias += 1;
                tiposGuiaMap.set(tipoGuia, atualTipoGuia);
            }
        }
        
        // Processa o Top 10 Procedimentos
        const topNegados = Array.from(procedimentosMap.entries())
            .map(([codigo, data]) => ({
                codigo: codigo,
                descricao: data.descricao,
                totalNegado: data.totalNegado,
                totalOcorrencias: data.totalOcorrencias
            }))
            .sort((a, b) => b.totalNegado - a.totalNegado)
            .slice(0, 10);
            
        // Processa o Top 10 Prestadores
        const topPrestadores = Array.from(prestadoresMap.entries())
            .map(([prestador, data]) => ({
                prestador: prestador,
                totalNegado: data.totalNegado,
                quantidadeGuias: data.quantidadeGuias
            }))
            .sort((a, b) => b.totalNegado - a.totalNegado)
            .slice(0, 10);
            
        // Processa os Tipos de Guia
        const topTiposGuia = Array.from(tiposGuiaMap.entries())
            .map(([tipoGuia, data]) => ({
                tipoGuia: tipoGuia,
                totalNegado: data.totalNegado,
                quantidadeGuias: data.quantidadeGuias
            }))
            .sort((a, b) => b.totalNegado - a.totalNegado);

        const valorMedio = quantidadeGuias > 0 ? totalGeralNegado / quantidadeGuias : 0;

        const estatisticas = {
            totalGeralNegado,
            quantidadeGuias,
            valorMedio,
            maiorNegativa,
            topNegados,
            topPrestadores,
            topTiposGuia
        };
        
        console.log('📊 Estatísticas calculadas com sucesso:', {
            totalGeralNegado,
            quantidadeGuias,
            topNegadosCount: topNegados.length,
            topPrestadoresCount: topPrestadores.length,
            topTiposGuiaCount: topTiposGuia.length
        });
        
        res.json({
            success: true,
            data: estatisticas
        });
        
    } catch (error) {
        console.error('❌ Erro ao calcular estatísticas:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
function getInicioSemana(dateString) {
    // Adiciona T12:00:00 para evitar problemas de fuso horário (UTC)
    const data = new Date(dateString + 'T12:00:00Z'); 
    const diaDaSemana = data.getUTCDay(); // 0 = Domingo, 1 = Segunda...
    const diff = data.getUTCDate() - diaDaSemana;
    const inicioSemana = new Date(data.setUTCDate(diff));
    return inicioSemana.toISOString().split('T')[0]; // Retorna YYYY-MM-DD
}
app.get('/api/sla-desempenho', async (req, res) => {
    try {
        console.log('🔄 Calculando estatísticas de SLA e Reguladores (POR SEMANA)...');
        
        const { startDate, endDate } = req.query;
        
        const dateQuery = {};
        if (startDate && endDate) {
             dateQuery.dataRegulacao = {
                $gte: startDate,
                $lte: endDate
            };
        }
        
        const baseMatch = { ...dateQuery, "statusRegulacao": { $exists: true } };
        
        const guiasEncontradas = await guiasCollection.find(baseMatch).project({
            tipoDeGuia: 1,
            situacaoSla: 1,
            reguladaAutomaticamente: 1,
            reguladores: 1,
            dataRegulacao: 1
        }).toArray();
        
        console.log(`🔍 Encontradas ${guiasEncontradas.length} guias para análise de SLA.`);

        const statsPorTipo = new Map();
        const statsPorRegulador = new Map();
        const statsPorData = new Map(); // Agora será por semana

        for (const guia of guiasEncontradas) {
            
            let dentroSLA = true;
            if (guia.situacaoSla === 'REGULADA_COM_ATRASO') {
                dentroSLA = false;
            } else if (guia.situacaoSla === 'REGULADA_NO_PRAZO') {
                dentroSLA = true;
            } else if (guia.reguladaAutomaticamente === true) {
                dentroSLA = true;
            }

            const tipoGuia = guia.tipoDeGuia || 'NÃO CLASSIFICADO';
            
            const tipoStats = statsPorTipo.get(tipoGuia) || { total: 0, dentroSLA: 0 };
            tipoStats.total++;
            if (dentroSLA) tipoStats.dentroSLA++;
            statsPorTipo.set(tipoGuia, tipoStats);

            // 🌟 AGREGAÇÃO SEMANAL AQUI 🌟
            if (guia.dataRegulacao) {
                const data = guia.dataRegulacao.substring(0, 10); 
                const semana = getInicioSemana(data); // Usa a função helper
                
                const dataStats = statsPorData.get(semana) || { total: 0, dentroSLA: 0 };
                dataStats.total++;
                if (dentroSLA) dataStats.dentroSLA++;
                statsPorData.set(semana, dataStats); // Salva pela chave da semana
            }

            const reguladores = guia.reguladores || [];
            if (reguladores.length === 0) {
                 const regStats = statsPorRegulador.get('Regulação Automática') || { total: 0, dentroSLA: 0 };
                 regStats.total++;
                 if (dentroSLA) regStats.dentroSLA++;
                 statsPorRegulador.set('Regulação Automática', regStats);
            } else {
                for (const reguladorObj of reguladores) {
                    const nome = reguladorObj.nomeRegulador || 'Regulador Desconhecido';
                    const regStats = statsPorRegulador.get(nome) || { total: 0, dentroSLA: 0 };
                    regStats.total++;
                    if (dentroSLA) regStats.dentroSLA++;
                    statsPorRegulador.set(nome, regStats);
                }
            }
        }

        // --- Processamento final dos dados ---

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

        // Gráfico 4 (Tendência Semanal)
        const tendenciaSLA = Array.from(statsPorData.entries()).map(([data, stats]) => ({
            data: data, // data = "YYYY-MM-DD" do início da semana
            percentualSLA: stats.total > 0 ? ((stats.dentroSLA / stats.total) * 100) : 0
        })).sort((a, b) => a.data.localeCompare(b.data)); // Ordena por data

        const desempenhoReguladores = Array.from(statsPorRegulador.entries())
            .filter(([nome]) => nome !== 'Regulação Automática') 
            .map(([nome, data]) => ({
                nome: nome,
                total: data.total,
                dentroSLA: data.dentroSLA,
                foraSLA: data.total - data.dentroSLA,
                percentualSLA: data.total > 0 ? ((data.dentroSLA / data.total) * 100).toFixed(2) : "0.00"
            }))
            .sort((a, b) => b.total - a.total); 

        console.log('📊 Estatísticas de SLA (Semanal) calculadas com sucesso.');
        
        res.json({
            success: true,
            data: {
                totalGuiasSLA,
                slaGeral,
                slaPorTipo,
                tendenciaSLA,
                desempenhoReguladores
            }
        });
        
    } catch (error) {
        console.error('❌ Erro ao calcular estatísticas de SLA:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'index.html'));
});
// Iniciar servidor
async function startServer() {
    const publicPath = path.join(__dirname, 'public');
    if (!require('fs').existsSync(publicPath)) {
        require('fs').mkdirSync(publicPath);
        console.log(`📁 Criada a pasta 'public' para o index.html.`);
    }

    try {
        await connectToMongoDB();
        app.listen(PORT, () => {
            console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
            console.log(`📊 Dashboard: http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Falha ao iniciar o servidor.');
        process.exit(1);
    }
}

startServer();
