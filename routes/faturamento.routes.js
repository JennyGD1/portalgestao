require('dotenv').config();
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.NEON_AUDITORIA_DB,
    ssl: { rejectUnauthorized: false }
});

// Helper para converter valores numéricos do Postgres
const parseNum = (val) => parseFloat(val || 0);

router.get('/estatisticas', async (req, res) => {
    try {
        const { producao } = req.query;
        // Filtro de produção
        const whereClause = producao ? `WHERE producao = $1` : '';
        const params = producao ? [producao] : [];

        // ---------------------------------------------------------
        // Queries SQL Otimizadas (Sem aspas nos aliases para evitar erros)
        // ---------------------------------------------------------

        // 1. KPIs Gerais
        const kpiQuery = `
            SELECT 
                COALESCE(SUM(valor_capa), 0) as total_apresentado,
                COALESCE(SUM(valor_liberado), 0) as total_liberado,
                COALESCE(SUM(valor_glosa), 0) as total_glosa,
                COUNT(*) as count
            FROM processos
            ${whereClause}
        `;

        // 2. Status Stats (Para os Cards Coloridos)
        const statusQuery = `
            SELECT 
                CASE 
                    WHEN status ILIKE 'CONCLUIDO' THEN 'tramitado'
                    ELSE LOWER(status)
                END as status_id,
                
                SUM(CASE 
                    WHEN status ILIKE 'CONCLUIDO' THEN valor_liberado 
                    ELSE valor_capa 
                END) as total_valor,
                
                COUNT(*) as quantidade
            FROM processos
            ${whereClause}
            GROUP BY 1
        `;

        // 3. Top Glosa (Maiores Glosas)
        const topGlosaQuery = `
            SELECT 
                credenciado as _id, 
                COALESCE(SUM(valor_glosa), 0) as total_glosa
            FROM processos
            ${whereClause ? whereClause + ' AND' : 'WHERE'} valor_glosa > 0
            AND credenciado IS NOT NULL AND credenciado != ''
            GROUP BY credenciado
            ORDER BY total_glosa DESC 
            LIMIT 10
        `;

        // 4. Top Volume (Volume Apresentado - CORRIGIDO)
        // Usamos COALESCE para garantir que não venha null
        const topVolumeQuery = `
            SELECT 
                credenciado as _id, 
                COALESCE(SUM(valor_capa), 0) as total_apresentado
            FROM processos
            ${whereClause ? whereClause + ' AND' : 'WHERE'} credenciado IS NOT NULL AND credenciado != ''
            GROUP BY credenciado
            ORDER BY total_apresentado DESC 
            LIMIT 10
        `;

        // 5. Tratamentos
        const tratamentosQuery = `
            SELECT 
                tratamento as _id, 
                COALESCE(SUM(valor_capa), 0) as total_valor, 
                COUNT(*) as quantidade
            FROM processos
            ${whereClause ? whereClause + ' AND' : 'WHERE'} tratamento IS NOT NULL AND tratamento != ''
            GROUP BY tratamento
            ORDER BY total_valor DESC
        `;

        // 6. Produtividade
        const prodWhere = whereClause ? whereClause + ` AND status ILIKE 'CONCLUIDO'` : `WHERE status ILIKE 'CONCLUIDO'`;
        const produtividadeQuery = `
            SELECT 
                responsavel as _id, 
                COALESCE(SUM(valor_capa), 0) as total_tramitado_valor, 
                COUNT(*) as total_tramitado_qtd
            FROM processos
            ${prodWhere} AND responsavel IS NOT NULL AND responsavel != ''
            GROUP BY responsavel
            ORDER BY total_tramitado_qtd DESC
        `;

        // Execução Paralela
        const [kpiRes, statusRes, topGlosaRes, topVolumeRes, tratamentosRes, produtividadeRes] = await Promise.all([
            pool.query(kpiQuery, params),
            pool.query(statusQuery, params),
            pool.query(topGlosaQuery, params),
            pool.query(topVolumeQuery, params),
            pool.query(tratamentosQuery, params),
            pool.query(produtividadeQuery, params)
        ]);

        const kpiRow = kpiRes.rows[0];
        const totalProcessosCompetencia = parseInt(kpiRow.count || 0);

        // Montagem do JSON (Mapeando snake_case do banco para camelCase do frontend)
        const data = {
            kpis: [{
                _id: null,
                totalApresentado: parseNum(kpiRow.total_apresentado),
                totalLiberado: parseNum(kpiRow.total_liberado),
                totalGlosa: parseNum(kpiRow.total_glosa),
                count: totalProcessosCompetencia
            }],
            statusStats: statusRes.rows.map(row => ({
                _id: row.status_id,
                totalValor: parseNum(row.total_valor),
                quantidade: parseInt(row.quantidade),
                totalCompetencia: totalProcessosCompetencia
            })),
            topGlosa: topGlosaRes.rows.map(row => ({
                _id: row._id,
                totalGlosa: parseNum(row.total_glosa)
            })),
            topVolume: topVolumeRes.rows.map(row => ({
                _id: row._id,
                totalApresentado: parseNum(row.total_apresentado)
            })),
            tratamentos: tratamentosRes.rows.map(row => ({
                _id: row._id,
                totalValor: parseNum(row.total_valor),
                quantidade: parseInt(row.quantidade)
            })),
            produtividade: produtividadeRes.rows.map(row => ({
                _id: row._id,
                totalTramitadoValor: parseNum(row.total_tramitado_valor),
                totalTramitadoQtd: parseInt(row.total_tramitado_qtd)
            }))
        };

        res.json({ success: true, data: data });

    } catch (error) {
        console.error('Erro Estatísticas Faturamento:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Rota Processos Analisados
router.get('/processos-analisados', async (req, res) => {
    try {
        const { producao } = req.query;
        const params = producao ? [producao] : [];
        const whereClause = producao ? `WHERE producao = $1` : '';

        const query = `
            SELECT 
                COUNT(*) as total_processos,
                SUM(CASE WHEN status ILIKE 'CONCLUIDO' THEN 1 ELSE 0 END) as processos_analisados
            FROM processos
            ${whereClause}
        `;

        const result = await pool.query(query, params);
        const row = result.rows[0];

        const totalProcessos = parseInt(row.total_processos || 0);
        const processosAnalisados = parseInt(row.processos_analisados || 0);

        res.json({
            success: true,
            data: {
                totalProcessos,
                processosAnalisados,
                processosNaoAnalisados: totalProcessos - processosAnalisados,
                percentualAnalisado: totalProcessos > 0 ? (processosAnalisados / totalProcessos) * 100 : 0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;