const express = require('express');
const router = express.Router();

// Rota principal de estatísticas do Faturamento
router.get('/estatisticas', async (req, res) => {
    try {
        const processosCollection = req.db.collection('processos');
        const { producao } = req.query; // Ex: "10/2025"

        const matchStage = {};
        
        if (producao) {
            matchStage.producao = producao;
        }

        const pipeline = [
            // 1. FILTRO GERAL
            { $match: matchStage },

            // 2. CONVERSÃO HÍBRIDA (NUMERO vs TEXTO)
            {
                $addFields: {
                    vCapaNum: {
                        $cond: {
                            if: { $isNumber: "$valorCapa" }, 
                            then: "$valorCapa",              
                            else: {                          
                                $convert: {
                                    input: {
                                        $replaceAll: {
                                            input: {
                                                $replaceAll: {
                                                    input: { $toString: { $ifNull: ["$valorCapa", "0"] } },
                                                    find: ".", replacement: ""
                                                }
                                            },
                                            find: ",", replacement: "."
                                        }
                                    },
                                    to: "double", onError: 0, onNull: 0
                                }
                            }
                        }
                    },
                    vInfoNum: {
                        $cond: {
                            if: { $isNumber: "$valorInformado" },
                            then: "$valorInformado",
                            else: {
                                $convert: {
                                    input: {
                                        $replaceAll: {
                                            input: {
                                                $replaceAll: {
                                                    input: { $toString: { $ifNull: ["$valorInformado", "0"] } },
                                                    find: ".", replacement: ""
                                                }
                                            },
                                            find: ",", replacement: "."
                                        }
                                    },
                                    to: "double", onError: 0, onNull: 0
                                }
                            }
                        }
                    },
                    vLibNum: {
                        $cond: {
                            if: { $isNumber: "$valorLiberado" },
                            then: "$valorLiberado",
                            else: {
                                $convert: {
                                    input: {
                                        $replaceAll: {
                                            input: {
                                                $replaceAll: {
                                                    input: { $toString: { $ifNull: ["$valorLiberado", "0"] } },
                                                    find: ".", replacement: ""
                                                }
                                            },
                                            find: ",", replacement: "."
                                        }
                                    },
                                    to: "double", onError: 0, onNull: 0
                                }
                            }
                        }
                    },
                    vGlosaNum: {
                        $cond: {
                            if: { $isNumber: "$valorGlosa" },
                            then: "$valorGlosa",
                            else: {
                                $convert: {
                                    input: {
                                        $replaceAll: {
                                            input: {
                                                $replaceAll: {
                                                    input: { $toString: { $ifNull: ["$valorGlosa", "0"] } },
                                                    find: ".", replacement: ""
                                                }
                                            },
                                            find: ",", replacement: "."
                                        }
                                    },
                                    to: "double", onError: 0, onNull: 0
                                }
                            }
                        }
                    }
                }
            },

            // 3. DEFINIÇÃO DE PRIORIDADE (Capa vs Informado)
            {
                $addFields: {
                    valorApresentadoCalc: {
                        $ifNull: ["$vCapaNum", "$vInfoNum", 0] 
                    },
                    valorLiberadoCalc: "$vLibNum"
                }
            },

            // 4. LÓGICA DA GLOSA (Com Trava de Status)
            {
                $addFields: {
                    // Verifica se o status indica finalização
                    isFinalizado: {
                        $regexMatch: { 
                            input: { $toString: "$status" }, 
                            regex: /tramitado|assinado|arquivado|finalizado/i 
                        }
                    }
                }
            },
            {
                $addFields: {
                    valorGlosaCalc: {
                        $cond: {
                            if: { $gt: ["$vGlosaNum", 0.01] }, // Se tem glosa explícita no banco
                            then: "$vGlosaNum",               // Usa sempre (mesmo se não finalizado)
                            else: {                           
                                $cond: {
                                    if: "$isFinalizado",      // SÓ CALCULA SE ESTIVER FINALIZADO
                                    then: {
                                        $max: [ 
                                            0, 
                                            { $subtract: ["$valorApresentadoCalc", "$valorLiberadoCalc"] } 
                                        ]
                                    },
                                    else: 0 // Se não finalizado e sem glosa no banco, considera 0
                                }
                            }
                        }
                    }
                }
            },

            // 5. AGRUPAMENTOS
            {
                $facet: {
                    // KPI: Totais Gerais
                    "kpis": [
                        {
                            $group: {
                                _id: null,
                                totalApresentado: { $sum: "$valorApresentadoCalc" },
                                totalLiberado: { $sum: "$valorLiberadoCalc" },
                                totalGlosa: { $sum: "$valorGlosaCalc" },
                                count: { $sum: 1 }
                            }
                        }
                    ],
                    // KPI: Status Detalhado
                    "statusStats": [
                        {
                            $group: {
                                _id: { $toLower: "$status" },
                                totalValor: { $sum: "$valorApresentadoCalc" },
                                quantidade: { $sum: 1 }
                            }
                        }
                    ],
                    // Gráfico: Top Prestadores (Maior Glosa)
                    "topGlosa": [
                        { $match: { valorGlosaCalc: { $gt: 0 } } },
                        {
                            $group: {
                                _id: "$credenciado",
                                totalGlosa: { $sum: "$valorGlosaCalc" }
                            }
                        },
                        // Filtro remove sem nome
                        { 
                            $match: { 
                                _id: { $nin: [null, "", " "] } 
                            } 
                        },
                        { $sort: { totalGlosa: -1 } },
                        { $limit: 10 }
                    ],
                    // Gráfico: Top Prestadores (Maior Volume Apresentado)
                    "topVolume": [
                        {
                            $group: {
                                _id: "$credenciado",
                                totalApresentado: { $sum: "$valorApresentadoCalc" }
                            }
                        },
                        { 
                            $match: { 
                                _id: { $nin: [null, "", " "] } 
                            } 
                        },
                        { $sort: { totalApresentado: -1 } },
                        { $limit: 10 }
                    ],
                    // Gráfico: Tipos de Tratamento
                    "tratamentos": [
                        {
                            $group: {
                                _id: "$tratamento",
                                totalValor: { $sum: "$valorApresentadoCalc" },
                                quantidade: { $sum: 1 }
                            }
                        },
                        { 
                            $match: { 
                                _id: { $nin: [null, "", " "] } 
                            } 
                        },
                        { $sort: { totalValor: -1 } }
                    ],
                    // Gráfico: Produtividade
                    "produtividade": [
                        { 
                            $match: { 
                                responsavel: { $exists: true, $ne: null, $ne: "" },
                                status: { 
                                    $in: [
                                        /Tramitado/i, 
                                        /Assinado/i
                                    ] 
                                }
                            } 
                        },
                        {
                            $group: {
                                _id: "$responsavel",
                                totalTramitadoValor: { 
                                    $sum: { 
                                        $cond: { 
                                            if: { $gt: ["$valorApresentadoCalc", 0] }, 
                                            then: "$valorApresentadoCalc", 
                                            else: "$valorLiberadoCalc" 
                                        }
                                    } 
                                },
                                totalTramitadoQtd: { $sum: 1 }
                            }
                        },
                        { $sort: { totalTramitadoQtd: -1 } }
                    ]
                }
            }
        ];

        const results = await processosCollection.aggregate(pipeline).toArray();
        const data = results[0];

        res.json({ success: true, data: data });

    } catch (error) {
        console.error('❌ Erro estatísticas faturamento:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
