const express = require('express');
const router = express.Router();

router.get('/estatisticas', async (req, res) => {
    try {
        const processosCollection = req.db.collection('processos');
        const { producao } = req.query; // Ex: "10/2025"

        const matchStage = {};
        
        if (producao) {
            matchStage.producao = producao;
        }

        const pipeline = [
            { $match: matchStage },

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

            {
                $addFields: {
                    valorApresentadoCalc: {
                        $ifNull: ["$vCapaNum", "$vInfoNum", 0] 
                    },
                    valorLiberadoCalc: "$vLibNum"
                }
            },

            {
                $addFields: {
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
                            if: { $gt: ["$vGlosaNum", 0.01] }, 
                            then: "$vGlosaNum",               
                            else: {                           
                                $cond: {
                                    if: "$isFinalizado",   
                                    then: {
                                        $max: [ 
                                            0, 
                                            { $subtract: ["$valorApresentadoCalc", "$valorLiberadoCalc"] } 
                                        ]
                                    },
                                    else: 0 
                                }
                            }
                        }
                    }
                }
            },

            {
                $facet: {
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
                    "statusStats": [
                        {
                            $group: {
                                _id: { $toLower: "$status" },
                                totalValor: { $sum: "$valorApresentadoCalc" },
                                quantidade: { $sum: 1 }
                            }
                        }
                    ],
                    "topGlosa": [
                        { $match: { valorGlosaCalc: { $gt: 0 } } },
                        {
                            $group: {
                                _id: "$credenciado",
                                totalGlosa: { $sum: "$valorGlosaCalc" }
                            }
                        },
                        { 
                            $match: { 
                                _id: { $nin: [null, "", " "] } 
                            } 
                        },
                        { $sort: { totalGlosa: -1 } },
                        { $limit: 10 }
                    ],
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
router.get('/processos-analisados', async (req, res) => {
    try {
        const processosCollection = req.db.collection('processos');
        const { producao } = req.query;

        const matchStage = {};
        if (producao) {
            matchStage.producao = producao;
        }

        const pipeline = [
            { $match: matchStage },
            
            {
                $facet: {
                    totalProcessos: [
                        { $count: "total" }
                    ],
                    processosComGT: [
                        { $match: { 
                            gt: { 
                                $exists: true, 
                                $ne: null, 
                                $ne: "" 
                            } 
                        }},
                        { $count: "total" }
                    ]
                }
            }
        ];

        const results = await processosCollection.aggregate(pipeline).toArray();
        const data = results[0];

        const totalProcessos = data.totalProcessos[0]?.total || 0;
        const processosAnalisados = data.processosComGT[0]?.total || 0;

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
        console.error('❌ Erro ao contar processos analisados:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
module.exports = router;
