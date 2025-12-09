require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.set('trust proxy', 1);

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

const SECRET_KEY = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
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
        '/api/auth/status',
        '/api/regulacao/',
        '/api/auditoria/',
        '/api/faturamento/',
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
    
    res.redirect('/login');
};

app.use(express.static(path.join(__dirname, 'public')));
app.use(verificarAutenticacao);

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
let db;

async function connectToMongoDB() {
    if (db) return db;
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);
    console.log('✅ MongoDB conectado');
    return db;
}

app.use(async (req, res, next) => {
    try {
        if (!db) await connectToMongoDB();
        req.db = db;
        next();
    } catch (error) {
        console.error('❌ Erro MongoDB:', error);
        res.status(500).json({ error: 'Erro no banco de dados' });
    }
});

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

// IMPORTE AS ROTAS - Use caminho absoluto
const regulacaoRoutes = require('./routes/regulacao.routes');
const auditoriaRoutes = require('./routes/auditoria.routes');
const faturamentoRoutes = require('./routes/faturamento.routes');

app.use('/api', regulacaoRoutes);
app.use('/api/auditoria', auditoriaRoutes);
app.use('/api/faturamento', faturamentoRoutes);

// Rota de teste
app.get('/api/teste', (req, res) => {
    res.json({ message: 'API funcionando', timestamp: new Date().toISOString() });
});

app.get('*', (req, res) => {
    if (req.usuario) return res.redirect('/');
    res.redirect('/login');
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT}`);
    });
}

module.exports = app;
