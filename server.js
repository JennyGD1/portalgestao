require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
const fs = require('fs');


// --- IMPORTAÇÃO DAS ROTAS ---
const regulacaoRoutes = require('./routes/regulacao.routes');
const auditoriaRoutes = require('./routes/auditoria.routes');

const app = express();
const PORT = 3000;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- CONFIGURAÇÃO MONGODB ---
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;

let db;

async function connectToMongoDB() {
    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('✅ Conectado ao MongoDB');
        db = client.db(DB_NAME);
    } catch (error) {
        console.error('❌ Erro ao conectar ao MongoDB:', error);
        process.exit(1);
    }
}

app.use((req, res, next) => {
    if (!db) {
        return res.status(500).json({ error: 'Conexão com banco de dados não estabelecida.' });
    }
    req.db = db;
    next();
});

// --- DEFINIÇÃO DE ROTAS (API) ---

// 1. Rotas de Regulação
// O arquivo regulacao.routes.js define '/guias-negadas', etc.
// Aqui com prefixo '/api', resultando em: '/api/guias-negadas'
app.use('/api', regulacaoRoutes);

// 2. Rotas de Auditoria
// O arquivo auditoria.routes.js define '/dashboard'.
// Aqui  com prefixo '/api/auditoria', resultando em: '/api/auditoria/dashboard'
app.use('/api/auditoria', auditoriaRoutes);

// --- ROTAS DE FRONTEND (HTML) ---

// Rota Principal (Regulação)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'index.html'));
});

// Nova Rota (Auditoria) - Acessível em http://localhost:3000/auditoria
app.get('/auditoria', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'auditoria.html'));
});

// Rota de fallback para garantir que regulacao.html também funcione direto
app.get('/html/regulacao.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'regulacao.html'));
});

// --- INICIALIZAÇÃO ---

async function startServer() {
    // Verifica pasta public (mantendo sua lógica original)
    const publicPath = path.join(__dirname, 'public');
    if (!fs.existsSync(publicPath)) {
        fs.mkdirSync(publicPath);
        console.log(`📁 Criada a pasta 'public'.`);
    }

    await connectToMongoDB();

    app.listen(PORT, () => {
        console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
        console.log(`📊 Dashboard Regulação: http://localhost:${PORT}`);
        console.log(`📋 Dashboard Auditoria: http://localhost:${PORT}/auditoria`);
    });
}

startServer();
