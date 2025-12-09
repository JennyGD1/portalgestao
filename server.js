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

// Configurações essenciais para Vercel
app.set('trust proxy', 1);

console.log('🚀 Iniciando servidor...');
console.log('🔐 SESSION_SECRET definido?', !!process.env.SESSION_SECRET);
console.log('🗄️ MONGODB_URI definido?', !!process.env.MONGODB_URI);

app.use(cors({
    origin: true, // Permite todas as origens para debug
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// DEBUG: Log de todas as requisições ANTES da sessão
app.use((req, res, next) => {
    console.log('📥 REQUEST INCOMING:', {
        method: req.method,
        path: req.path,
        ip: req.ip,
        protocol: req.protocol,
        secure: req.secure,
        host: req.get('host'),
        'x-forwarded-proto': req.get('x-forwarded-proto')
    });
    next();
});

// SESSÃO
console.log('🔧 Configurando sessão...');
app.use(session({
    secret: process.env.SESSION_SECRET || 'debug_secret_temp_123',
    resave: true, // Alterado para true para debug
    saveUninitialized: true, // Alterado para true para debug
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        collectionName: 'sessions',
        ttl: 24 * 60 * 60,
        autoRemove: 'native',
        mongoOptions: {
            connectTimeoutMS: 10000,
            socketTimeoutMS: 45000,
        }
    }),
    cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        secure: true,
        httpOnly: true,
        sameSite: 'lax' // Começa com 'lax' para debug
    },
    proxy: true,
    name: 'portal.sid', // Nome mais simples
    rolling: true,
    unset: 'destroy'
}));

// DEBUG: Log APÓS sessão ser configurada
app.use((req, res, next) => {
    console.log('🔍 APÓS SESSÃO:', {
        path: req.path,
        sessionId: req.sessionID,
        session: req.session,
        cookies: req.headers.cookie,
        'set-cookie': res.getHeader('set-cookie')
    });
    next();
});

// Middleware de autenticação
const verificarAutenticacao = (req, res, next) => {
    console.log('🔐 VERIFICANDO AUTENTICAÇÃO:', {
        path: req.path,
        sessionId: req.sessionID,
        usuario: req.session?.usuario || 'NÃO AUTENTICADO',
        sessionExiste: !!req.session
    });
    
    // Verifique se req.session existe primeiro
    if (!req.session) {
        console.log('⚠️ ATENÇÃO: req.session não existe!');
        return next(); // Continua para login
    }
    
    if (req.session.usuario) {
        console.log('✅ USUÁRIO AUTENTICADO:', req.session.usuario);
        return next();
    }

    const caminhosPublicos = [
        '/login',
        '/api/auth/login',
        '/api/test-cookie',
        '/logout',
        '/favicon.ico',
        '/css/',
        '/js/',
        '/images/',
        '/fonts/'
    ];

    const ehPublico = caminhosPublicos.some(caminho => req.path.startsWith(caminho));

    if (ehPublico) {
        console.log('📖 ACESSO PÚBLICO PERMITIDO:', req.path);
        return next();
    }

    console.log('🚫 ACESSO NEGADO - Redirecionando para /login');
    res.redirect('/login');
};

app.use(verificarAutenticacao);

app.use(express.static(path.join(__dirname, 'public')));

// Conexão MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
let db;

async function connectToMongoDB() {
    try {
        if (db) {
            console.log('📡 MongoDB já conectado');
            return db;
        }
        console.log('📡 Conectando ao MongoDB...');
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('✅ Conectado ao MongoDB');
        db = client.db(DB_NAME);
        return db;
    } catch (error) {
        console.error('❌ Erro ao conectar ao MongoDB:', error);
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
        console.error('❌ Erro no middleware de conexão:', error);
        res.status(500).json({ error: 'Erro de conexão com o banco de dados' });
    }
});

// Endpoint para testar cookies
app.get('/api/test-cookie', (req, res) => {
    console.log('🍪 TESTE DE COOKIE - HEADERS:', {
        cookies: req.headers.cookie,
        host: req.get('host'),
        origin: req.get('origin'),
        referer: req.get('referer')
    });
    
    // Setar cookie de teste
    res.cookie('test_cookie', 'valor_teste_' + Date.now(), {
        maxAge: 900000,
        httpOnly: true,
        secure: true,
        sameSite: 'lax'
    });
    
    res.json({
        mensagem: 'Teste de cookie',
        cookiesRecebidos: req.headers.cookie,
        sessionId: req.sessionID,
        usuario: req.session?.usuario || 'não autenticado',
        session: req.session
    });
});

// Rota de login com debug detalhado
app.post('/api/auth/login', async (req, res) => {
    console.log('🔐 TENTATIVA DE LOGIN - REQUEST:', {
        body: req.body,
        sessionId: req.sessionID,
        sessionAntes: req.session,
        headers: {
            cookie: req.headers.cookie,
            origin: req.headers.origin
        }
    });
    
    const { usuario, senha } = req.body;
    
    const USUARIO_CORRETO = process.env.ADMIN_USER;
    const SENHA_CORRETA = process.env.ADMIN_PASSWORD;
    
    console.log('🔐 CREDENCIAIS:', {
        recebido: { usuario, senha },
        esperado: { USUARIO_CORRETO: USUARIO_CORRETO ? 'DEFINIDO' : 'NÃO DEFINIDO' }
    });

    if (usuario === USUARIO_CORRETO && senha === SENHA_CORRETA) {
        console.log('✅ CREDENCIAIS CORRETAS');
        
        // Salva o usuário na sessão
        req.session.usuario = { 
            nome: usuario, 
            funcao: 'admin',
            dataLogin: new Date(),
            sessionId: req.sessionID
        };
        
        console.log('💾 SALVANDO SESSÃO...', req.session);
        
        // Salva a sessão explicitamente
        req.session.save((err) => {
            if (err) {
                console.error('❌ Erro ao salvar sessão:', err);
                return res.status(500).json({ 
                    success: false, 
                    erro: 'Erro interno ao salvar sessão',
                    detalhes: err.message 
                });
            }
            
            console.log('✅ SESSÃO SALVA:', {
                sessionId: req.sessionID,
                usuario: req.session.usuario,
                cookie: req.session.cookie
            });
            
            // Log dos headers que serão enviados
            console.log('📤 RESPONSE HEADERS:', {
                'set-cookie': res.getHeader('set-cookie')
            });
            
            return res.json({ 
                success: true, 
                usuario: { nome: usuario, funcao: 'admin' },
                sessionId: req.sessionID,
                debug: {
                    sessionSaved: true,
                    cookieSet: !!res.getHeader('set-cookie')
                }
            });
        });
    } else {
        console.log('❌ CREDENCIAIS INVÁLIDAS');
        return res.status(401).json({ 
            success: false, 
            erro: 'Credenciais inválidas',
            debug: {
                usuarioRecebido: usuario,
                senhaRecebida: senha ? 'PRESENTE' : 'AUSENTE',
                usuarioEsperado: USUARIO_CORRETO ? 'DEFINIDO' : 'NÃO DEFINIDO'
            }
        });
    }
});

// Rota para verificar status da sessão
app.get('/api/auth/status', (req, res) => {
    console.log('📊 STATUS DA SESSÃO:', {
        sessionId: req.sessionID,
        usuario: req.session?.usuario,
        cookies: req.headers.cookie
    });
    
    if (req.session?.usuario) {
        return res.json({ 
            autenticado: true, 
            usuario: req.session.usuario,
            sessionId: req.sessionID
        });
    }
    return res.json({ 
        autenticado: false,
        sessionId: req.sessionID,
        cookies: req.headers.cookie
    });
});

app.get('/logout', (req, res) => {
    console.log('👋 LOGOUT:', req.sessionID);
    req.session.destroy((err) => {
        if (err) {
            console.error('❌ Erro ao destruir sessão:', err);
        }
        res.redirect('/login');
    });
});

// Rotas para páginas HTML
app.get('/login', (req, res) => {
    console.log('📄 SERVIDO LOGIN.HTML:', {
        usuario: req.session?.usuario,
        sessionId: req.sessionID
    });
    
    if (req.session?.usuario) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'html', 'login.html'));
});

app.get('/', (req, res) => {
    console.log('📄 SERVIDO INDEX.HTML:', {
        usuario: req.session?.usuario,
        sessionId: req.sessionID
    });
    res.sendFile(path.join(__dirname, 'public', 'html', 'index.html'));
});

app.get('/auditoria', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'auditoria.html'));
});

app.get('/faturamento', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'faturamento.html'));
});

// Rotas da API
app.use('/api', regulacaoRoutes);
app.use('/api/auditoria', auditoriaRoutes);
app.use('/api/faturamento', faturamentoRoutes);

// Rota curinga
app.get('*', (req, res) => {
    console.log('🌟 ROTA CURINGA:', req.path);
    if (req.session?.usuario) {
        return res.redirect('/');
    }
    res.redirect('/login');
});

// Log de inicialização
console.log('⚙️ Configuração completa do servidor');

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`🚀 Servidor rodando localmente na porta ${PORT}`);
        console.log(`📁 Pasta pública: ${path.join(__dirname, 'public')}`);
        console.log(`🔐 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    });
}

module.exports = app;
