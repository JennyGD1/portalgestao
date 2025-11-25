const express = require('express');
const router = express.Router();

// Rota: /api/auditoria/dashboard
router.get('/dashboard', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const collection = req.db.collection('auditoria');

        const query = {};
        if (startDate && endDate) {
            query["auditoria.dataAuditoria"] = {
                $gte: startDate,
                $lte: endDate
            };
        }

        const docs = await collection.find(query).limit(2000).toArray();

        // Variáveis para KPIs
        let totalContasApresentadas = 0;
        let totalContasGlosadas = 0;
        let totalContasApuradas = 0;
        let somaDiasInternacao = 0;
        let countInternacoesComData = 0;
        let countGuias = docs.length;

        const prestadoresMap = new Map();
        const auditoresMap = new Map();
        const categoriasMap = new Map();
        const motivosGlosaMap = new Map();

        const dispersaoData = [];
        const evolucaoMap = new Map(); 

        const PLACEHOLDERS_GLOSA_IGNORADOS = [
            '', // String vazia
            'sem justificativa', 
            'nao justificado', 
            'n/a', 
            'null', 
            'nao informado',
            'não informado',
            'sem motivo',
            'nao se aplica',
            'não se aplica',
            'não especificado',
            'nao especificado'
        ];

        docs.forEach(doc => {
            const aud = doc.auditoria || {};
            const atend = doc.atendimento || {};
            const prest = doc.prestador || {};

            // 1. KPIs Financeiros
            totalContasApresentadas += (aud.valorTotalApresentado || 0);
            totalContasGlosadas += (aud.valorTotalGlosado || 0);
            totalContasApuradas += (aud.valorTotalApurado || 0);

            // 2. Tempo Médio de Internamento
            if (atend.dataInternacao && atend.dataAlta) {
            const inicio = new Date(atend.dataInternacao);
            const fim = new Date(atend.dataAlta);
            
            // Remove o Math.abs para detectar datas invertidas
            const diffTime = fim - inicio; 
            
            // Converte para dias
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            // --- BLOCO DE SEGURANÇA E DETECÇÃO ---
            
            // 1. Ignora se a data de Alta for ANTERIOR à internação (negativo)
            if (diffDays < 0) {
                console.warn(`[ALERTA] Data Invertida - ID: ${doc._id}, Prestador: ${prest.nomePrestador}`);
                return; 
            }

            // 2. Acha o registro absurdo (ex: maior que 365 dias)
            if (diffDays > 365) {
                console.warn(`[ALERTA] Internação Longa (${diffDays} dias) - ID: ${doc._id}, Paciente: ${atend.nomePaciente || 'N/A'}`);

            }
            

            somaDiasInternacao += diffDays;
            countInternacoesComData++;
        }

            // 3. Glosa por Prestador
            const nomePrestador = prest.nomeFantasia || prest.nomePrestador || 'N/A';
            const pData = prestadoresMap.get(nomePrestador) || { nome: nomePrestador, glosa: 0, total: 0 };
            pData.glosa += (aud.valorTotalGlosado || 0);
            pData.total += (aud.valorTotalApresentado || 0);
            prestadoresMap.set(nomePrestador, pData);

            // 4. Desempenho Auditor
            const nomeAuditor = aud.nomeEnfermeiroResponsavel;

            if (nomeAuditor && nomeAuditor.trim() !== '') {
                const aData = auditoresMap.get(nomeAuditor) || { nome: nomeAuditor, guias: 0, glosaTotal: 0 };
                aData.guias++;
                aData.glosaTotal += (aud.valorTotalGlosado || 0);
                auditoresMap.set(nomeAuditor, aData);
            }

            // 5. Detalhamento por Categoria (Itens)
            if (aud.itens) {
                Object.values(aud.itens).forEach(item => {
                    // Ignora o objeto 'relatorio' que está dentro de itens
                    if (!item.tipo) return; 

                    const tipo = item.tipo;
                    const catData = categoriasMap.get(tipo) || { 
                        tipo: tipo, 
                        apresentado: 0, 
                        glosado: 0, 
                        apurado: 0 
                    };
                    
                    catData.apresentado += (item.valorApresentado || 0);
                    catData.glosado += (item.valorGlosado || 0);
                    catData.apurado += (item.valorApurado || 0);
                    categoriasMap.set(tipo, catData);

                    // Motivos de Glosa
                    if ((item.valorGlosado || 0) > 0) {
                        const motivoOriginal = item.motivoDeGlosa;
                        
                        if (!motivoOriginal) {
                            return;
                        }
                        
                        const motivoTratado = String(motivoOriginal).trim().toLowerCase();
                        
                        if (PLACEHOLDERS_GLOSA_IGNORADOS.includes(motivoTratado)) {
                            return;
                        }
                        
                        const mCount = motivosGlosaMap.get(motivoOriginal) || 0;
                        motivosGlosaMap.set(motivoOriginal, mCount + (item.valorGlosado || 0));
                    }
                });
            }

            if (atend.dataInternacao && atend.dataAlta && aud.valorTotalApresentado) {
                const inicio = new Date(atend.dataInternacao);
                const fim = new Date(atend.dataAlta);
                const diffTime = Math.abs(fim - inicio);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                dispersaoData.push({
                    tempoInternacao: diffDays,
                    custoTotal: aud.valorTotalApresentado,
                    especialidade: atend.especialidade || 'N/A'
                });
            }

            if (aud.dataAuditoria) {
                const dataAud = new Date(aud.dataAuditoria);
                
                // --- TRAVA DE SEGURANÇA ---
                // Se o ano for menor que 2000, ignora este registro no gráfico temporal
                if (dataAud.getFullYear() < 2000) {
                    return; 
                }
                // --------------------------

                const mesAno = `${dataAud.getFullYear()}-${(dataAud.getMonth() + 1).toString().padStart(2, '0')}`;
                
                const mesData = evolucaoMap.get(mesAno) || { 
                    mes: mesAno, 
                    apresentado: 0, 
                    glosado: 0, 
                    guias: 0 
                };
                
                mesData.apresentado += (aud.valorTotalApresentado || 0);
                mesData.glosado += (aud.valorTotalGlosado || 0);
                mesData.guias += 1;
                
                evolucaoMap.set(mesAno, mesData);
            }
        });

        // Processamento Final dos Dados
        const tempoMedioInternamento = countInternacoesComData > 0 ? (somaDiasInternacao / countInternacoesComData).toFixed(1) : 0;
        const custoMedioInternamento = countGuias > 0 ? (totalContasApuradas / countGuias) : 0;
        const glosaMediaInternamento = countGuias > 0 ? (totalContasGlosadas / countGuias) : 0;

        // Ordenações
        const topPrestadoresGlosa = Array.from(prestadoresMap.values())
            .sort((a, b) => b.glosa - a.glosa)
            .slice(0, 10);

        const desempenhoAuditores = Array.from(auditoresMap.values())
            .sort((a, b) => b.glosaTotal - a.glosaTotal);

        const categoriasDetalhadas = Array.from(categoriasMap.values());
        
        const topMotivosGlosa = Array.from(motivosGlosaMap.entries())
            .map(([motivo, valor]) => ({ motivo, valor }))
            .sort((a, b) => b.valor - a.valor)
            .slice(0, 5);

        const evolucaoFormatada = Array.from(evolucaoMap.values())
            .sort((a, b) => a.mes.localeCompare(b.mes))
            .slice(-6) // Últimos 6 meses
            .map(mes => ({
                mes: new Date(mes.mes + '-01').toLocaleDateString('pt-BR', { month: 'short' }),
                apresentado: mes.apresentado,
                glosado: mes.glosado,
                guias: mes.guias
            }));

        res.json({
            success: true,
            kpis: {
                totalApresentado: totalContasApresentadas,
                totalGlosado: totalContasGlosadas,
                tempoMedioInternamento,
                custoMedioInternamento,
                glosaMediaInternamento,
                countGuias
            },
            charts: {
                prestadores: topPrestadoresGlosa,
                auditores: desempenhoAuditores,
                categorias: categoriasDetalhadas,
                motivos: topMotivosGlosa,
                dispersao: dispersaoData.slice(0, 50), // Limita a 50 pontos
                evolucao: evolucaoFormatada
            }
        });

    } catch (error) {
        console.error('Erro na rota de auditoria:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
