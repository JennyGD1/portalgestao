require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const MongoStore = require('connect-mongo'); 

const regulacaoRoutes = require('./routes/regulacao.routes');
const auditoriaRoutes = require('./routes/auditoria.routes');
const faturamentoRoutes = require('./routes/faturamento.routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'segredo_padrao_muito_seguro',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI, 
        collectionName: 'sessions', 
        ttl: 24 * 60 * 60
    }),
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, 
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true
    }
}));

app.use(express.static(path.join(__dirname, 'public')));

const verificarAutenticacao = (req, res, next) => {
    if (req.session.usuario) {
        return next();
    }

    const caminhosPublicos = [
        '/login',           
        '/api/auth/login', 
        '/css/',            
        '/js/',             
        '/images/'          
    ];

    const ehPublico = caminhosPublicos.some(caminho => req.path.startsWith(caminho));

    if (ehPublico) {
        return next();
    }


    res.redirect('/login');
};

app.use(verificarAutenticacao);

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
let db;

async function connectToMongoDB() {
    try {
        if (db) return db;
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('✅ Conectado ao MongoDB');
        db = client.db(DB_NAME);
    } catch (error) {
        console.error('❌ Erro Mongo:', error);
    }
}

app.use(async (req, res, next) => {
    if (!db) await connectToMongoDB();
    req.db = db;
    next();
});

app.post('/api/auth/login', (req, res) => {
    const { usuario, senha } = req.body;
    
    const USUARIO_CORRETO = process.env.ADMIN_USER;
    const SENHA_CORRETA = process.env.ADMIN_PASSWORD;

    if (usuario === USUARIO_CORRETO && senha === SENHA_CORRETA) {
        req.session.usuario = { nome: usuario, funcao: 'admin' };
        return res.json({ success: true });
    }

    return res.status(401).json({ success: false, erro: 'Credenciais inválidas' });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.use('/api', regulacaoRoutes);
app.use('/api/auditoria', auditoriaRoutes);
app.use('/api/faturamento', faturamentoRoutes);

app.get('/login', (req, res) => {
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

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`🚀 Rodando localmente na porta ${PORT}`);
    });
}

module.exports = app;
