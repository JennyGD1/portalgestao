require('dotenv').config();
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

// Configuração da conexão com o NeonDB
const pool = new Pool({
    connectionString: process.env.NEON_AUDITORIA_DB,
    ssl: {
        rejectUnauthorized: false
    }
});

// Rota: /api/auditoria/dashboard
router.get('/dashboard', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        // Construção da Query SQL Dinâmica
        let sqlQuery = `
            SELECT 
                autorizacao_guia,
                valor_total_apresentado,
                valor_total_glosado,
                valor_total_apurado,
                data_internacao,
                data_alta,
                prestador_nome,
                prestador_nome_fantasia,
                nome_enfermeiro_responsavel,
                detalhes_itens,
                especialidade,
                data_auditoria,
                motivo_alta
            FROM auditoria_guias
        `;

        const queryParams = [];
        
        // Filtro de datas (Postgres usa $1, $2 para parâmetros)
        if (startDate && endDate) {
            sqlQuery += ` WHERE data_auditoria >= $1 AND data_auditoria <= $2`;
            queryParams.push(startDate, endDate);
        }

        // Limite para segurança de performance (igual ao original)
        sqlQuery += ` LIMIT 2000`;

        // Executa a busca no NeonDB
        const result = await pool.query(sqlQuery, queryParams);
        const rows = result.rows;

        // Variáveis para KPIs
        let totalContasApresentadas = 0;
        let totalContasGlosadas = 0;
        let totalContasApuradas = 0;
        let somaDiasInternacao = 0;
        let countInternacoesComData = 0;
        let countGuias = rows.length;

        const prestadoresMap = new Map();
        const auditoresMap = new Map();
        const categoriasMap = new Map();
        const motivosGlosaMap = new Map();

        const dispersaoData = [];
        const evolucaoMap = new Map(); 

        const PLACEHOLDERS_GLOSA_IGNORADOS = [
            '', 'sem justificativa', 'nao justificado', 'n/a', 'null', 
            'nao informado', 'não informado', 'sem motivo', 'nao se aplica',
            'não se aplica', 'não especificado', 'nao especificado'
        ];

        // Iteração sobre as linhas do SQL
        rows.forEach(row => {
            // === ADAPTADOR (SQL -> Estrutura Antiga) ===
            // Recriamos a estrutura de objetos para aproveitar a lógica existente
            const aud = {
                valorTotalApresentado: parseFloat(row.valor_total_apresentado || 0),
                valorTotalGlosado: parseFloat(row.valor_total_glosado || 0),
                valorTotalApurado: parseFloat(row.valor_total_apurado || 0),
                nomeEnfermeiroResponsavel: row.nome_enfermeiro_responsavel,
                // O Postgres já retorna o JSONB parseado como objeto JS
                itens: row.detalhes_itens || {}, 
                dataAuditoria: row.data_auditoria
            };

            const atend = {
                dataInternacao: row.data_internacao,
                dataAlta: row.data_alta,
                especialidade: row.especialidade
            };

            const prest = {
                nomePrestador: row.prestador_nome,
                nomeFantasia: row.prestador_nome_fantasia
            };
            // ==========================================

            // 1. KPIs Financeiros
            totalContasApresentadas += aud.valorTotalApresentado;
            totalContasGlosadas += aud.valorTotalGlosado;
            totalContasApuradas += aud.valorTotalApurado;

            // 2. Tempo Médio de Internamento
            if (atend.dataInternacao && atend.dataAlta) {
                const inicio = new Date(atend.dataInternacao);
                const fim = new Date(atend.dataAlta);
                
                const diffTime = fim - inicio; 
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                // Validações de data
                if (diffDays < 0) {
                    // console.warn(`[ALERTA] Data Invertida - Guia: ${row.autorizacao_guia}`);
                    return; 
                }

                if (diffDays > 365) {
                    // console.warn(`[ALERTA] Internação Longa (${diffDays} dias) - Guia: ${row.autorizacao_guia}`);
                }

                somaDiasInternacao += diffDays;
                countInternacoesComData++;
            }

            // 3. Glosa por Prestador
            const nomePrestador = prest.nomeFantasia || prest.nomePrestador || 'N/A';
            const pData = prestadoresMap.get(nomePrestador) || { nome: nomePrestador, glosa: 0, total: 0 };
            pData.glosa += aud.valorTotalGlosado;
            pData.total += aud.valorTotalApresentado;
            prestadoresMap.set(nomePrestador, pData);

            // 4. Desempenho Auditor
            const nomeAuditor = aud.nomeEnfermeiroResponsavel;
            if (nomeAuditor && nomeAuditor.trim() !== '') {
                const aData = auditoresMap.get(nomeAuditor) || { nome: nomeAuditor, guias: 0, glosaTotal: 0 };
                aData.guias++;
                aData.glosaTotal += aud.valorTotalGlosado;
                auditoresMap.set(nomeAuditor, aData);
            }

            // 5. Detalhamento por Categoria (Itens - JSONB)
            if (aud.itens) {
                Object.values(aud.itens).forEach(item => {
                    if (!item || !item.tipo) return; 

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
                        
                        if (!motivoOriginal) return;
                        
                        const motivoTratado = String(motivoOriginal).trim().toLowerCase();
                        
                        if (PLACEHOLDERS_GLOSA_IGNORADOS.includes(motivoTratado)) return;
                        
                        const mCount = motivosGlosaMap.get(motivoOriginal) || 0;
                        motivosGlosaMap.set(motivoOriginal, mCount + (item.valorGlosado || 0));
                    }
                });
            }

            // 6. Dispersão
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

            // 7. Evolução Temporal
            if (aud.dataAuditoria) {
                const dataAud = new Date(aud.dataAuditoria);
                
                if (dataAud.getFullYear() >= 2000) {
                    const mesAno = `${dataAud.getFullYear()}-${(dataAud.getMonth() + 1).toString().padStart(2, '0')}`;
                    
                    const mesData = evolucaoMap.get(mesAno) || { 
                        mes: mesAno, 
                        apresentado: 0, 
                        glosado: 0, 
                        guias: 0 
                    };
                    
                    mesData.apresentado += aud.valorTotalApresentado;
                    mesData.glosado += aud.valorTotalGlosado;
                    mesData.guias += 1;
                    
                    evolucaoMap.set(mesAno, mesData);
                }
            }
        });

        // --- Processamento Final (Idêntico ao original) ---
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
            .slice(-6) 
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
                dispersao: dispersaoData.slice(0, 50),
                evolucao: evolucaoFormatada
            }
        });

    } catch (error) {
        console.error('Erro na rota de auditoria (NeonDB):', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;