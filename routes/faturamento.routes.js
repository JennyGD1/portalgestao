const express = require('express');
const router = express.Router();

router.get('/estatisticas', async (req, res) => {
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
                    valorApresentadoCalc: "$vCapaNum",
                    valorLiberadoCalc: "$vLibNum",
                    valorGlosaCalc: "$vGlosaNum"
                }
            },

            {
                $facet: {
                    kpis: [
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
                    statusStats: [
                    {
                        $group: {
                        _id: {
                            $replaceAll: {
                            input: {
                                $replaceAll: {
                                input: { $toLower: "$status" },
                                find: "á", replacement: "a"
                                }
                            },
                            find: "ã", replacement: "a"
                            }
                        },
                        totalValor: { $sum: "$valorApresentadoCalc" },
                        quantidade: { $sum: 1 }
                        }
                    }
                    ],
                    topGlosa: [
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
                    topVolume: [
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
                    tratamentos: [
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
                    produtividade: [
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
        console.error(error);
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
                    processosTramitados: [
                        { 
                            $match: { 
                                status: /assinado e tramitado/i 
                            } 
                        },
                        { $count: "total" }
                    ]
                }
            }
        ];

        const results = await processosCollection.aggregate(pipeline).toArray();
        const data = results[0];

        const totalProcessos = data.totalProcessos[0]?.total || 0;
        const processosAnalisados = data.processosTramitados[0]?.total || 0; 

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
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
}); 
module.exports = router;
