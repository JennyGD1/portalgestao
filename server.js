require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb'); // ✅ IMPORTANTE: Adicionar isso!
const { Pool } = require('pg'); // ✅ Para NeonDB
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// CONFIGURAÇÃO NEONDB (PostgreSQL)
// =============================================
const neonPool = new Pool({
    connectionString: process.env.NEON_AUDITORIA_DB,
    ssl: { rejectUnauthorized: false }
});

// =============================================
// CONFIGURAÇÃO MONGODB
// =============================================
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
let mongoDb;

async function connectToMongoDB() {
    if (mongoDb) return mongoDb;
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    mongoDb = client.db(DB_NAME);
    console.log('✅ MongoDB conectado');
    return mongoDb;
}

// =============================================
// MIDDLEWARES GLOBAIS
// =============================================
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.set('trust proxy', 1);

// Logger
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// =============================================
// MIDDLEWARE DE BANCO DE DADOS - CRÍTICO!
// =============================================
app.use(async (req, res, next) => {
    try {
        // Disponibiliza NeonDB (PostgreSQL) para todas as rotas
        req.pool = neonPool;
        
        // Disponibiliza MongoDB para todas as rotas
        req.db = await connectToMongoDB();
        
        next();
    } catch (error) {
        console.error('❌ Erro ao conectar bancos de dados:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erro de conexão com os bancos de dados' 
        });
    }
});

// =============================================
// AUTENTICAÇÃO
// =============================================
const SECRET_KEY = process.env.SESSION_SECRET || 'chave_secreta_fixa_para_desenvolvimento_123456';
const MAX_AGE = 24 * 60 * 60 * 1000;

const verificarAutenticacao = (req, res, next) => {
    const token = req.cookies.auth_token;
    
    if (token) {
        try {
            const [usuario, timestamp, assinatura] = token.split('|');
            const expectedSignature = crypto
                .createHmac('sha256', SECRET_KEY)
                .update(`${usuario}|${timestamp}`)
                .digest('hex');
            
            if (assinatura === expectedSignature && Date.now() - parseInt(timestamp) < MAX_AGE) {
                req.usuario = usuario;
                return next();
            }
        } catch (error) {
            console.error('Erro na verificação do token:', error);
        }
    }
    
    const caminhosPublicos = [
        '/login',
        '/api/auth/login',
        '/logout',
        '/css/',
        '/js/',
        '/img/',
        '/images/',
        '/fonts/',
        '/favicon.ico',
        '/favicon.png'
    ];
    
    const ehPublico = caminhosPublicos.some(caminho => req.path.startsWith(caminho));
    
    if (ehPublico) {
        return next();
    }
    if (req.path.startsWith('/api/')) {
        res.clearCookie('auth_token'); 
        return res.status(401).json({ success: false, error: 'Sessão expirada ou inválida' });
    }
    res.redirect('/login');
};

app.use(express.static(path.join(__dirname, 'public')));
app.use(verificarAutenticacao);

// =============================================
// ROTAS DE AUTENTICAÇÃO
// =============================================
app.post('/api/auth/login', (req, res) => {
    const { usuario, senha } = req.body;
    const USUARIO_CORRETO = process.env.ADMIN_USER || 'admin';
    const SENHA_CORRETA = process.env.ADMIN_PASSWORD || 'senha123';
    
    if (usuario === USUARIO_CORRETO && senha === SENHA_CORRETA) {
        const timestamp = Date.now();
        const data = `${usuario}|${timestamp}`;
        const assinatura = crypto.createHmac('sha256', SECRET_KEY).update(data).digest('hex');
        const token = `${data}|${assinatura}`;
        
        res.cookie('auth_token', token, {
            maxAge: MAX_AGE,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax'
        });
        
        return res.json({ success: true, usuario: usuario });
    }
    
    return res.status(401).json({ success: false, erro: 'Credenciais inválidas' });
});

app.get('/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.redirect('/login');
});

app.get('/api/auth/status', (req, res) => {
    res.json({ autenticado: !!req.usuario, usuario: req.usuario });
});

// =============================================
// ROTAS DE PÁGINAS
// =============================================
app.get('/login', (req, res) => {
    if (req.usuario) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'html', 'login.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'index.html'));
});

app.get('/auditoria', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'auditoria.html'));
});

app.get('/faturamento', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'faturamento.html'));
});

// =============================================
// ROTAS DA API
// =============================================
const regulacaoRoutes = require('./routes/regulacao.routes');
const auditoriaRoutes = require('./routes/auditoria.routes');
const faturamentoRoutes = require('./routes/faturamento.routes');

app.use('/api/regulacao', regulacaoRoutes);
app.use('/api/auditoria', auditoriaRoutes);
app.use('/api/faturamento', faturamentoRoutes);

// Rota de teste
app.get('/api/teste', (req, res) => {
    res.json({ 
        message: 'API funcionando', 
        timestamp: new Date().toISOString(),
        databases: {
            mongodb: !!req.db,
            neondb: !!req.pool
        }
    });
});

// =============================================
// FALLBACK
// =============================================
app.get('*', (req, res) => {
    if (req.usuario) return res.redirect('/');
    res.redirect('/login');
});

// =============================================
// INICIALIZAÇÃO
// =============================================
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, async () => {
        console.log(`🚀 Servidor rodando na porta ${PORT}`);
        // Tenta conectar MongoDB na inicialização
        try {
            await connectToMongoDB();
            console.log('✅ MongoDB pronto para uso');
        } catch (error) {
            console.error('❌ Falha ao conectar MongoDB:', error);
        }
    });
}

module.exports = app;