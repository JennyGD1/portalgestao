require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const regulacaoRoutes = require('./routes/regulacao.routes');
const auditoriaRoutes = require('./routes/auditoria.routes');
const faturamentoRoutes = require('./routes/faturamento.routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'segredo_padrao_muito_seguro',
    resave: true,
    saveUninitialized: true,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        collectionName: 'sessions',
        ttl: 24 * 60 * 60,
        autoRemove: 'native'
    }),
    cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        secure: true,
        httpOnly: true,
        sameSite: 'lax'
    },
    proxy: true,
    name: 'portal.sid',
    rolling: true
}));

const verificarAutenticacao = (req, res, next) => {
    if (req.session.usuario) {
        return next();
    }

    const caminhosPublicos = [
        '/login',
        '/api/auth/login',
        '/logout',
        '/favicon.ico',
        '/css/',
        '/js/',
        '/images/',
        '/fonts/'
    ];

    const ehPublico = caminhosPublicos.some(caminho => req.path.startsWith(caminho));

    if (ehPublico) {
        return next();
    }

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
        console.error('Erro no middleware de conexão:', error);
        res.status(500).json({ error: 'Erro de conexão com o banco de dados' });
    }
});

app.post('/api/auth/login', (req, res) => {
    const { usuario, senha } = req.body;
    
    const USUARIO_CORRETO = process.env.ADMIN_USER;
    const SENHA_CORRETA = process.env.ADMIN_PASSWORD;

    if (usuario === USUARIO_CORRETO && senha === SENHA_CORRETA) {
        req.session.usuario = { 
            nome: usuario, 
            funcao: 'admin',
            dataLogin: new Date()
        };
        
        req.session.save((err) => {
            if (err) {
                return res.status(500).json({ success: false, erro: 'Erro interno' });
            }
            
            return res.json({ 
                success: true, 
                usuario: { nome: usuario, funcao: 'admin' }
            });
        });
    } else {
        return res.status(401).json({ 
            success: false, 
            erro: 'Credenciais inválidas' 
        });
    }
});

app.get('/api/auth/status', (req, res) => {
    if (req.session.usuario) {
        return res.json({ 
            autenticado: true, 
            usuario: req.session.usuario 
        });
    }
    return res.json({ autenticado: false });
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Erro ao destruir sessão:', err);
        }
        res.redirect('/login');
    });
});

app.get('/login', (req, res) => {
    if (req.session.usuario) {
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
    if (req.session.usuario) {
        return res.redirect('/');
    }
    res.redirect('/login');
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Servidor rodando localmente na porta ${PORT}`);
    });
}

module.exports = app;
