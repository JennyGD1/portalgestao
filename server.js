require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const regulacaoRoutes = require('./routes/regulacao.routes');
const auditoriaRoutes = require('./routes/auditoria.routes');
const faturamentoRoutes = require('./routes/faturamento.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurações
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.set('trust proxy', 1);

const SECRET_KEY = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const MAX_AGE = 24 * 60 * 60 * 1000; // 24 horas

const verificarAutenticacao = (req, res, next) => {
    const token = req.cookies.auth_token;
    
    if (token) {
        try {
            const [usuario, timestamp, assinatura] = token.split('|');
            const expectedSignature = crypto
                .createHmac('sha256', SECRET_KEY)
                .update(`${usuario}|${timestamp}`)
                .digest('hex');
            
            if (assinatura === expectedSignature && 
                Date.now() - parseInt(timestamp) < MAX_AGE) {
                
                req.usuario = usuario;
                return next();
            }
        } catch (error) {
            // Token inválido
        }
    }
    
    const caminhosPublicos = [
        '/login',
        '/api/auth/login',
        '/css/',
        '/js/',
        '/images/',
        '/fonts/',
        '/favicon.ico'
    ];
    
    const ehPublico = caminhosPublicos.some(caminho => req.path.startsWith(caminho));
    
    if (ehPublico) {
        return next();
    }
    
    // Não autenticado → redireciona para login
    res.redirect('/login');
};

app.use(verificarAutenticacao);
app.use(express.static(path.join(__dirname, 'public')));

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
let db;

async function connectToMongoDB() {
    try {
        if (db) return db;
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('Conectado ao MongoDB');
        db = client.db(DB_NAME);
        return db;
    } catch (error) {
        console.error('Erro ao conectar ao MongoDB:', error);
        throw error;
    }
}

app.use(async (req, res, next) => {
    try {
        if (!db) {
            db = await connectToMongoDB();
        }
        req.db = db;
        next();
    } catch (error) {
        res.status(500).json({ error: 'Erro de conexão com o banco de dados' });
    }
});

app.post('/api/auth/login', (req, res) => {
    const { usuario, senha } = req.body;
    
    const USUARIO_CORRETO = process.env.ADMIN_USER || 'admin';
    const SENHA_CORRETA = process.env.ADMIN_PASSWORD || 'senha123';
    
    if (usuario === USUARIO_CORRETO && senha === SENHA_CORRETA) {
        const timestamp = Date.now();
        const data = `${usuario}|${timestamp}`;
        const assinatura = crypto
            .createHmac('sha256', SECRET_KEY)
            .update(data)
            .digest('hex');
        
        const token = `${data}|${assinatura}`;
        
        res.cookie('auth_token', token, {
            maxAge: MAX_AGE,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax'
        });
        
        return res.json({ 
            success: true, 
            usuario: usuario 
        });
    }
    
    return res.status(401).json({ 
        success: false, 
        erro: 'Credenciais inválidas' 
    });
});

app.get('/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.redirect('/login');
});

app.get('/api/auth/status', (req, res) => {
    if (req.usuario) {
        return res.json({ 
            autenticado: true, 
            usuario: req.usuario 
        });
    }
    return res.json({ autenticado: false });
});

// Rotas para páginas HTML
app.get('/login', (req, res) => {
    if (req.usuario) {
        return res.redirect('/');
    }
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

app.use('/api', regulacaoRoutes);
app.use('/api/auditoria', auditoriaRoutes);
app.use('/api/faturamento', faturamentoRoutes);

app.get('*', (req, res) => {
    if (req.usuario) {
        return res.redirect('/');
    }
    res.redirect('/login');
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT}`);
    });
}

module.exports = app;
